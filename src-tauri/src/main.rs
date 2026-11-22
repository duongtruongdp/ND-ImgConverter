// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let mappings = [
        ("--nd-engine-update-probe-engine", "ND_ENGINE_UPDATE_PROBE_ENGINE"),
        ("--nd-engine-update-probe-output", "ND_ENGINE_UPDATE_PROBE_OUTPUT"),
        ("--nd-engine-update-media-output", "ND_ENGINE_UPDATE_MEDIA_OUTPUT"),
        ("--nd-media-engines-dir", "ND_MEDIA_ENGINES_DIR"),
        ("--nd-engine-update-media-url", "ND_ENGINE_UPDATE_MEDIA_URL"),
        ("--nd-engine-update-gallery-url", "ND_ENGINE_UPDATE_GALLERY_URL"),
        ("--nd-engine-update-seed-bundled", "ND_ENGINE_UPDATE_SEED_BUNDLED"),
        ("--nd-runtime-probe-output", "ND_RUNTIME_PROBE_OUTPUT"),
    ];
    for (flag, variable) in mappings {
        if let Some(value) = args
            .windows(2)
            .find(|pair| pair[0] == flag)
            .map(|pair| pair[1].clone())
        {
            std::env::set_var(variable, value);
        }
    }
    if args.iter().any(|argument| argument == "--nd-engine-update-lifecycle") {
        std::process::exit(nd_image_converter_lib::run_headless_engine_update_lifecycle_probe());
    }
    nd_image_converter_lib::run()
}
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkConfig {
    pub enabled: bool,
    pub is_text: bool,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub position: String,      // "TopLeft", "BottomRight", ...
    pub opacity: f32,
    pub scale_percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOptions {
    pub format: String,
    pub quality: u8,
    pub resize_mode: String,
    pub target_width: Option<u32>,
    pub scale_percentage: Option<u32>,
    pub maintain_aspect_ratio: bool,
    pub output_directory: Option<String>,
    pub color_space: String,
    // 2 required fields for v0.6.0:
    pub strip_metadata: Option<bool>,
    pub watermark: Option<WatermarkConfig>,
}
