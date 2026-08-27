use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Jpeg,
    Png,
    Webp,
    Avif,
    Bmp,
    Ico,
    Icns,
    Tiff,
    Tga,
    Gif,
    Exr,
    Pbm,
    Pdf,
    Psd,
    Dds,
    Jp2,
    Ktx,
    Pvr,
    Astc,
}

impl OutputFormat {
    pub fn is_supported_output(&self) -> bool {
        matches!(
            self,
            Self::Jpeg
                | Self::Png
                | Self::Webp
                | Self::Avif
                | Self::Bmp
                | Self::Ico
                | Self::Tiff
                | Self::Tga
                | Self::Gif
                | Self::Exr
                | Self::Pbm
                | Self::Pdf
        )
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Jpeg => "JPEG",
            Self::Png => "PNG",
            Self::Webp => "WEBP",
            Self::Avif => "AVIF",
            Self::Bmp => "BMP",
            Self::Ico => "ICO",
            Self::Icns => "ICNS",
            Self::Tiff => "TIFF",
            Self::Tga => "TGA",
            Self::Gif => "GIF",
            Self::Exr => "EXR",
            Self::Pbm => "PBM",
            Self::Pdf => "PDF",
            Self::Psd => "PSD",
            Self::Dds => "DDS",
            Self::Jp2 => "JP2",
            Self::Ktx => "KTX",
            Self::Pvr => "PVR",
            Self::Astc => "ASTC",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::OutputFormat;

    #[test]
    fn output_capabilities_match_available_encoders() {
        assert!(OutputFormat::Png.is_supported_output());
        assert!(OutputFormat::Exr.is_supported_output());
        assert!(OutputFormat::Pdf.is_supported_output());
        assert!(!OutputFormat::Psd.is_supported_output());
        assert!(!OutputFormat::Astc.is_supported_output());
    }
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum TargetColorSpace {
    Original,
    Srgb,
    DisplayP3,
    AdobeRgb,
}

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum MetadataPolicy {
    KeepAll,
    RemoveLocation,
    StripAll,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSettings {
    pub policy: MetadataPolicy,
    pub keep_exif: bool,
    pub keep_icc: bool,
    pub keep_gps: bool,
    pub keep_copyright: bool,
}

impl Default for MetadataSettings {
    fn default() -> Self {
        Self {
            policy: MetadataPolicy::RemoveLocation,
            keep_exif: true,
            keep_icc: true,
            keep_gps: false,
            keep_copyright: true,
        }
    }
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
    pub resize_mode: Option<ResizeMode>,
    pub target_width: Option<u32>,
    pub scale_percentage: Option<u32>,
    pub maintain_aspect_ratio: Option<bool>,
    pub output_directory: Option<String>,
    pub color_space: Option<TargetColorSpace>,
    pub strip_metadata: Option<bool>,
    pub watermark: Option<crate::watermark::WatermarkConfig>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub size: u64,
    pub thumbnail_base64: String,
    pub format_name: String,
    pub color_profile: Option<String>,
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub iso: Option<u32>,
    pub f_number: Option<String>,
    pub exposure_time: Option<String>,
    pub has_gps: bool,
}
