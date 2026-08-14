use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use exif::{In, Reader, Tag};

#[derive(Debug, Default, Clone)]
pub struct ExtractedMetadata {
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub iso: Option<u32>,
    pub f_number: Option<String>,
    pub exposure_time: Option<String>,
    pub has_gps: bool,
}

/// Đọc thông số EXIF kỹ thuật từ file gốc
pub fn extract_exif_info(file_path: &Path) -> ExtractedMetadata {
    let mut meta = ExtractedMetadata::default();

    let file = match File::open(file_path) {
        Ok(f) => f,
        Err(_) => return meta,
    };

    let mut bufreader = BufReader::new(&file);
    let exifreader = Reader::new();
    if let Ok(exif) = exifreader.read_from_container(&mut bufreader) {
        // Camera Model
        if let Some(field) = exif.get_field(Tag::Model, In::PRIMARY) {
            meta.camera_model = Some(field.display_value().to_string().replace('"', ""));
        }

        // Lens Model
        if let Some(field) = exif.get_field(Tag::LensModel, In::PRIMARY) {
            meta.lens_model = Some(field.display_value().to_string().replace('"', ""));
        }

        // ISO
        if let Some(field) = exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY) {
            if let Some(val) = field.value.get_uint(0) {
                meta.iso = Some(val);
            }
        }

        // F-Number
        if let Some(field) = exif.get_field(Tag::FNumber, In::PRIMARY) {
            meta.f_number = Some(format!("f/{}", field.display_value()));
        }

        // Exposure Time
        if let Some(field) = exif.get_field(Tag::ExposureTime, In::PRIMARY) {
            meta.exposure_time = Some(format!("{}s", field.display_value()));
        }

        // Kiểm tra toạ độ GPS
        meta.has_gps = exif.get_field(Tag::GPSLatitude, In::PRIMARY).is_some();
    }

    meta
}