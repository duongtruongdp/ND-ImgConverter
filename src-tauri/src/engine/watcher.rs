use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::engine::pipeline::process_single_image;
use crate::models::conversion::ConversionOptions;
use crate::video::{convert, VideoConvertOptions};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WatcherEventPayload {
    pub media_type: String,
    pub source_file: String,
    pub output_file: Option<String>,
    pub output_size: Option<u64>,
    pub success: bool,
    pub error: Option<String>,
    pub timestamp: String,
}

pub struct FolderWatcherState {
    pub is_watching: Arc<AtomicBool>,
    // Giữ debouncer alive trong bộ nhớ
    pub _debouncer: Arc<Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>>,
}

impl FolderWatcherState {
    pub fn new() -> Self {
        Self {
            is_watching: Arc::new(AtomicBool::new(false)),
            _debouncer: Arc::new(Mutex::new(None)),
        }
    }
}

pub fn start_folder_watcher(
    app: AppHandle,
    state: &FolderWatcherState,
    watch_path: String,
    output_path: String,
    options: ConversionOptions,
    video_options: VideoConvertOptions,
) -> Result<(), String> {
    let watch_dir = PathBuf::from(&watch_path);
    if !watch_dir.exists() || !watch_dir.is_dir() {
        return Err("Thư mục theo dõi không tồn tại".to_string());
    }

    let out_dir = PathBuf::from(&output_path);
    if !out_dir.exists() {
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    }

    state.is_watching.store(true, Ordering::SeqCst);
    let is_watching_flag = state.is_watching.clone();

    let app_clone = app.clone();
    let mut target_options = options.clone();
    target_options.output_directory = Some(output_path.clone());
    let mut target_video_options = video_options.clone();
    target_video_options.output_directory = Some(output_path.clone());

    // Thiết lập debouncer 1.5 giây để chờ file copy xong hoàn toàn
    let mut debouncer = new_debouncer(
        Duration::from_millis(1500),
        move |res: DebounceEventResult| {
            if !is_watching_flag.load(Ordering::SeqCst) {
                return;
            }

            if let Ok(events) = res {
                for event in events {
                    let path = event.path;
                    if !path.is_file() {
                        continue;
                    }

                    let ext = path
                        .extension()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_lowercase();

                    let image_extensions = [
                        "jpg", "jpeg", "png", "webp", "svg", "bmp", "ico", "gif", "tiff", "tif",
                        "tga", "pnm", "qoi", "avif", "arw", "cr2", "crw", "dng", "nef", "orf",
                        "pef", "raf", "rw2", "sr2", "srf", "psd", "exr", "heic", "heif",
                    ];

                    let video_extensions = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];
                    let media_type = if image_extensions.contains(&ext.as_str()) {
                        "image"
                    } else if video_extensions.contains(&ext.as_str()) {
                        "video"
                    } else {
                        continue;
                    };
                    let output_root = PathBuf::from(&output_path);
                    if path.starts_with(&output_root) { continue; }

                    let path_str = path.to_string_lossy().to_string();
                    let result = if media_type == "image" {
                        process_single_image(&path_str, &target_options).map(|res| (res.output_path, res.output_size))
                    } else {
                        convert(VideoConvertOptions { input_path: path_str.clone(), ..target_video_options.clone() })
                            .map(|output| { let size = std::fs::metadata(&output).map(|meta| meta.len()).unwrap_or(0); (output, size) })
                            .map_err(|error| crate::errors::EngineError::EncodeFailed(error))
                    };

                    let payload = match result {
                        Ok(res) => WatcherEventPayload {
                            media_type: media_type.to_string(),
                            source_file: path_str,
                            output_file: Some(res.0),
                            output_size: Some(res.1),
                            success: true,
                            error: None,
                            timestamp: chrono_now(),
                        },
                        Err(err) => WatcherEventPayload {
                            media_type: media_type.to_string(),
                            source_file: path_str,
                            output_file: None,
                            output_size: None,
                            success: false,
                            error: Some(err.to_string()),
                            timestamp: chrono_now(),
                        },
                    };

                    let _ = app_clone.emit("folder-automation-event", payload);
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(Path::new(&watch_path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    let mut lock = state._debouncer.lock().map_err(|_| "Lock error")?;
    *lock = Some(debouncer);

    Ok(())
}

pub fn stop_folder_watcher(state: &FolderWatcherState) -> Result<(), String> {
    state.is_watching.store(false, Ordering::SeqCst);
    let mut lock = state._debouncer.lock().map_err(|_| "Lock error")?;
    *lock = None;
    Ok(())
}

fn chrono_now() -> String {
    use std::time::SystemTime;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let hours = (now / 3600 % 24 + 7) % 24; // GMT+7
    let minutes = now / 60 % 60;
    let seconds = now % 60;
    format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
}
