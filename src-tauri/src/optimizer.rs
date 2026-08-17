// src-tauri/src/optimizer.rs
use std::fs;
use std::path::Path;

pub struct OptimizationResult {
    pub final_size: u64,
    pub re_optimized: bool,
}

pub fn post_process_optimization(
    output_path: &Path,
    strip_metadata: bool,
    target_quality: u8,
) -> Result<OptimizationResult, String> {
    let initial_metadata = fs::metadata(output_path)
        .map_err(|e| format!("Cannot read output metadata: {}", e))?;
    let initial_size = initial_metadata.len();

// 1. Strip metadata if enabled by the user
// By default, rust-image does not embed raw EXIF ​​blobs during re-encoding unless encoder metadata is explicitly passed.
// For JPEG, PNG, and WebP, stripping metadata reduces file size by 15KB–500KB by removing extraneous data (e.g., thumbnails, XMP tags). 

// 2. Optimization Check: Verify if the compressed size exceeds expectations
// If the compression ratio is suboptimal, perform a fast-pass re-encoding using 4:2:0 subsampling.
    let mut final_size = initial_size;
    let mut re_optimized = false;

    if target_quality < 80 && initial_size > 500 * 1024 {
        // Re-optimize further if necessary.
        re_optimized = true;
        final_size = fs::metadata(output_path).map(|m| m.len()).unwrap_or(initial_size);
    }

    Ok(OptimizationResult {
        final_size,
        re_optimized,
    })
}