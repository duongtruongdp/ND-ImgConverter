use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Jpeg,
    Png,
    Webp,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ResizeMode {
    Original,
    Width,
    Percentage,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOptions {
    pub format: OutputFormat,
    pub quality: u8,
    pub resize_mode: ResizeMode,
    pub target_width: Option<u32>,
    pub scale_percentage: Option<u32>,
    pub maintain_aspect_ratio: bool,
    pub output_directory: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversionResult {
    pub input_path: String,
    pub output_path: String,
    pub output_size: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub file_path: String,
    pub output_path: Option<String>,
    pub output_size: Option<u64>,
    pub success: bool,
    pub error: Option<String>,
    pub completed: usize,
    pub total: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub size: u64,
    pub thumbnail_base64: String,
}