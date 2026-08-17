mod watermark;
mod engine;
mod errors;
mod models;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use rayon::prelude::*;
use std::path::Path;

use crate::engine::pipeline::{
    estimate_single_file_size, get_image_metadata, process_single_image,
};
use crate::engine::watcher::{start_folder_watcher, stop_folder_watcher, FolderWatcherState};
use crate::errors::EngineError;
use crate::models::conversion::{
    ConversionOptions, ImageMetadata, OutputFormat, ProgressPayload,
};

pub struct AppState {
    pub is_cancelled: Arc<AtomicBool>,
    pub watcher_state: FolderWatcherState,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchSizeEstimation {
    pub total_original_bytes: u64,
    pub total_estimated_bytes: u64,
    pub savings_percentage: f64,
    pub quality_tier: String,
}

#[tauri::command]
fn calculate_quality_estimate(
    items: Vec<ImageMetadata>,
    format: OutputFormat,
    quality: u8,
) -> BatchSizeEstimation {
    let mut total_orig: u64 = 0;
    let mut total_est: u64 = 0;

    for item in &items {
        total_orig += item.size;
        let est = estimate_single_file_size(item.size, item.width, item.height, &format, quality);
        total_est += est;
    }

    let savings = if total_orig > 0 && total_est < total_orig {
        ((total_orig - total_est) as f64 / total_orig as f64) * 100.0
    } else {
        0.0
    };

    let tier = match quality {
        95..=100 => "Near Lossless",
        80..=94 => "High Studio Quality",
        65..=79 => "Web Balanced",
        50..=64 => "Maximum Compression",
        _ => "Aggressive Space Saver",
    };

    BatchSizeEstimation {
        total_original_bytes: total_orig,
        total_estimated_bytes: total_est,
        savings_percentage: (savings * 10.0).round() / 10.0,
        quality_tier: tier.to_string(),
    }
}

#[tauri::command]
async fn fetch_batch_metadata(paths: Vec<String>) -> Vec<Option<ImageMetadata>> {
    paths
        .into_par_iter()
        .map(|p| get_image_metadata(&p).ok())
        .collect()
}

#[tauri::command]
async fn read_image_as_data_url(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    let base64_str = base64::engine::general_purpose::STANDARD.encode(&data);
    
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();

    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "image/png",
    };

    Ok(format!("data:{};base64,{}", mime, base64_str))
}

#[tauri::command]
async fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        let p = std::path::Path::new(&path);
        let dir = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn start_batch_conversion(
    app: AppHandle,
    state: State<'_, AppState>,
    files: Vec<String>,
    options: ConversionOptions,
) -> Result<(), String> {
    state.is_cancelled.store(false, Ordering::SeqCst);
    let total = files.len();

    let is_cancelled = state.is_cancelled.clone();
    let completed_counter = std::sync::atomic::AtomicUsize::new(0);

    files.into_par_iter().for_each(|file_path| {
        if is_cancelled.load(Ordering::SeqCst) {
            return;
        }

        let result = process_single_image(&file_path, &options);
        let completed = completed_counter.fetch_add(1, Ordering::SeqCst) + 1;

        let payload = match result {
            Ok(res) => ProgressPayload {
                file_path: file_path.clone(),
                output_path: Some(res.output_path),
                output_size: Some(res.output_size),
                success: true,
                error: None,
                completed,
                total,
            },
            Err(e) => ProgressPayload {
                file_path: file_path.clone(),
                output_path: None,
                output_size: None,
                success: false,
                error: Some(e.to_string()),
                completed,
                total,
            },
        };

        let _ = app.emit("conversion-progress", payload);
    });

    Ok(())
}

#[tauri::command]
async fn cancel_conversion(state: State<'_, AppState>) -> Result<(), String> {
    state.is_cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn start_watch_automation(
    app: AppHandle,
    state: State<'_, AppState>,
    watch_path: String,
    output_path: String,
    options: ConversionOptions,
) -> Result<(), String> {
    start_folder_watcher(app, &state.watcher_state, watch_path, output_path, options)
}

#[tauri::command]
async fn stop_watch_automation(state: State<'_, AppState>) -> Result<(), String> {
    stop_folder_watcher(&state.watcher_state)
}
fn collect_images_recursively(path: &Path, result: &mut Vec<String>) {
    let valid_extensions = [
        "jpg", "jpeg", "png", "webp", "svg", "bmp", "ico", "gif", "tiff", "tif",
        "tga", "pnm", "qoi", "avif", "arw", "cr2", "crw", "dng", "nef", "orf",
        "pef", "raf", "rw2", "sr2", "srf", "psd", "exr", "heic", "heif",
    ];

    if path.is_file() {
        if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
            if valid_extensions.contains(&ext.to_lowercase().as_str()) {
                result.push(path.to_string_lossy().to_string());
            }
        }
    } else if path.is_dir() {
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                collect_images_recursively(&entry.path(), result);
            }
        }
    }
}

#[tauri::command]
async fn scan_dropped_paths(paths: Vec<String>) -> Vec<String> {
    let mut image_paths = Vec::new();
    for p in paths {
        let path = Path::new(&p);
        collect_images_recursively(path, &mut image_paths);
    }
    image_paths
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            is_cancelled: Arc::new(AtomicBool::new(false)),
            watcher_state: FolderWatcherState::new(),
        })
        .invoke_handler(tauri::generate_handler![
            fetch_batch_metadata,
            read_image_as_data_url,
            reveal_in_finder,
            start_batch_conversion,
            cancel_conversion,
            start_watch_automation,
            stop_watch_automation,
            calculate_quality_estimate,
            scan_dropped_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}