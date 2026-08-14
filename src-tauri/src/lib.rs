mod engine;
mod errors;
mod models;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, State};
use rayon::prelude::*;

use engine::pipeline::{get_image_metadata, process_single_image};
use errors::EngineError;
use models::conversion::{ConversionOptions, ImageMetadata, ProgressPayload};

pub struct AppState {
    pub is_cancelled: Arc<AtomicBool>,
}

#[tauri::command]
async fn cancel_conversion(state: State<'_, AppState>) -> Result<(), ()> {
    state.is_cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn fetch_batch_metadata(paths: Vec<String>) -> Result<Vec<Option<ImageMetadata>>, ()> {
    let results = tokio::task::spawn_blocking(move || {
        paths
            .par_iter()
            .map(|p| get_image_metadata(p).ok())
            .collect::<Vec<Option<ImageMetadata>>>()
    })
    .await
    .unwrap_or_default();

    Ok(results)
}

#[tauri::command]
fn reveal_in_finder(path: String) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path)).spawn();
    }
}

#[tauri::command]
async fn start_batch_conversion(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    files: Vec<String>,
    options: ConversionOptions,
) -> Result<(), EngineError> {
    state.is_cancelled.store(false, Ordering::SeqCst);
    let is_cancelled = Arc::clone(&state.is_cancelled);
    let total = files.len();
    let completed_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));

    tokio::task::spawn_blocking(move || {
        files.par_iter().for_each(|file_path| {
            if is_cancelled.load(Ordering::SeqCst) {
                return;
            }

            let result = process_single_image(file_path, &options);
            let count = completed_counter.fetch_add(1, Ordering::SeqCst) + 1;

            let (success, error, output_path, output_size) = match result {
                Ok(res) => (true, None, Some(res.output_path), Some(res.output_size)),
                Err(e) => (false, Some(e.to_string()), None, None),
            };

            let _ = app_handle.emit(
                "conversion-progress",
                ProgressPayload {
                    file_path: file_path.clone(),
                    output_path,
                    output_size,
                    success,
                    error,
                    completed: count,
                    total,
                },
            );
        });
    })
    .await
    .map_err(|_| EngineError::Cancelled)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            is_cancelled: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            fetch_batch_metadata,
            reveal_in_finder,
            start_batch_conversion,
            cancel_conversion
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}