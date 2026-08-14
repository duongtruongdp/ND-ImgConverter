use image::{imageops::FilterType, DynamicImage};
use crate::models::conversion::{ConversionOptions, ResizeMode};

pub fn apply_resize(img: DynamicImage, options: &ConversionOptions) -> DynamicImage {
    let (orig_w, orig_h) = (img.width(), img.height());

    match options.resize_mode {
        ResizeMode::Original => img,
        ResizeMode::Width => {
            if let Some(target_w) = options.target_width {
                if target_w > 0 && target_w != orig_w {
                    if options.maintain_aspect_ratio {
                        let target_h = ((orig_h as f32 / orig_w as f32) * target_w as f32).round() as u32;
                        img.resize(target_w, target_h, FilterType::Lanczos3)
                    } else {
                        img.resize_exact(target_w, orig_h, FilterType::Lanczos3)
                    }
                } else {
                    img
                }
            } else {
                img
            }
        }
        ResizeMode::Percentage => {
            if let Some(percent) = options.scale_percentage {
                if percent > 0 && percent != 100 {
                    let scale = percent as f32 / 100.0;
                    let target_w = (orig_w as f32 * scale).round() as u32;
                    let target_h = (orig_h as f32 * scale).round() as u32;
                    img.resize(target_w, target_h, FilterType::Lanczos3)
                } else {
                    img
                }
            } else {
                img
            }
        }
    }
}