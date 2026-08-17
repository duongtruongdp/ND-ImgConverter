use image::{imageops::FilterType, DynamicImage, GenericImageView};
use crate::models::conversion::{ConversionOptions, ResizeMode};

pub fn apply_resize(img: DynamicImage, options: &ConversionOptions) -> DynamicImage {
    let mode = options.resize_mode.as_ref().unwrap_or(&ResizeMode::Original);
    let maintain_aspect = options.maintain_aspect_ratio.unwrap_or(true);

    match mode {
        ResizeMode::Original => img,
        ResizeMode::Width => {
            if let Some(target_w) = options.target_width {
                if target_w > 0 && target_w != img.width() {
                    let (w, h) = img.dimensions();
                    if maintain_aspect {
                        let target_h = (((h as f64) / (w as f64)) * (target_w as f64)).round() as u32;
                        return img.resize_exact(target_w, target_h.max(1), FilterType::Lanczos3);
                    } else {
                        return img.resize_exact(target_w, h, FilterType::Lanczos3);
                    }
                }
            }
            img
        }
        ResizeMode::Percentage => {
            if let Some(scale_pct) = options.scale_percentage {
                if scale_pct > 0 && scale_pct != 100 {
                    let factor = (scale_pct as f64) / 100.0;
                    let target_w = ((img.width() as f64) * factor).round() as u32;
                    let target_h = ((img.height() as f64) * factor).round() as u32;
                    return img.resize_exact(target_w.max(1), target_h.max(1), FilterType::Lanczos3);
                }
            }
            img
        }
    }
}