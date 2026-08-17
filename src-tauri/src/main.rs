// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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