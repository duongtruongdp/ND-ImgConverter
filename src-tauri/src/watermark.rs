use ab_glyph::{Font, FontArc, PxScale, ScaleFont};
use image::{imageops, DynamicImage, GenericImageView, Rgba};
use imageproc::drawing::draw_text_mut;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkConfig {
    pub enabled: bool,
    pub is_text: bool,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub position: String,
    pub opacity: f32,
    pub scale_percent: f32,
}

pub fn apply_watermark(
    base_img: &mut DynamicImage,
    config: &WatermarkConfig,
) -> Result<(), String> {
    if !config.enabled {
        return Ok(());
    }

    let (base_w, base_h) = base_img.dimensions();

    if config.is_text {
        if let Some(text) = &config.text_content {
            if text.trim().is_empty() {
                return Ok(());
            }

            let mut rgba_img = base_img.to_rgba8();
            let font_data = include_bytes!("../assets/Roboto-Bold.ttf");
            let font = FontArc::try_from_slice(font_data)
                .map_err(|e| format!("Failed to parse embedded font: {}", e))?;

            let font_size = ((base_h as f32) * (config.scale_percent / 100.0)).clamp(16.0, 300.0);
            let scale = PxScale::from(font_size);
            let scaled_font = font.as_scaled(scale);

            let mut text_w: f32 = 0.0;
            for c in text.chars() {
                text_w += scaled_font.h_advance(scaled_font.glyph_id(c));
            }
            let text_h = scaled_font.height();

            let alpha = ((config.opacity.clamp(0.1, 1.0)) * 255.0) as u8;
            let color = Rgba([255, 255, 255, alpha]);

            let margin = ((base_w.min(base_h) as f32) * 0.015).max(16.0) as u32;

            let (x, y) = calculate_coordinates(
                &config.position,
                base_w,
                base_h,
                text_w.ceil() as u32,
                text_h.ceil() as u32,
                margin,
            );

            draw_text_mut(&mut rgba_img, color, x as i32, y as i32, scale, &font, text);
            *base_img = DynamicImage::ImageRgba8(rgba_img);
        }
    } else if let Some(logo_path) = &config.image_path {
        if !logo_path.is_empty() {
            if let Ok(logo) = image::open(logo_path) {
                let target_w = (((base_w as f32) * (config.scale_percent / 100.0)) as u32).max(20);
                let target_h = (((logo.height() as f32 / logo.width() as f32) * target_w as f32) as u32).max(20);

                let resized_logo = logo.resize_exact(target_w, target_h, imageops::FilterType::Lanczos3);
                let mut logo_rgba = resized_logo.to_rgba8();

                for pixel in logo_rgba.pixels_mut() {
                    pixel[3] = ((pixel[3] as f32) * config.opacity.clamp(0.0, 1.0)) as u8;
                }

                let margin = ((base_w.min(base_h) as f32) * 0.015).max(16.0) as u32;
                let (x, y) = calculate_coordinates(
                    &config.position,
                    base_w,
                    base_h,
                    target_w,
                    target_h,
                    margin,
                );

                imageops::overlay(base_img, &logo_rgba, x as i64, y as i64);
            }
        }
    }

    Ok(())
}

fn calculate_coordinates(
    pos: &str,
    base_w: u32,
    base_h: u32,
    item_w: u32,
    item_h: u32,
    margin: u32,
) -> (u32, u32) {
    let x = match pos {
        "TopLeft" | "CenterLeft" | "BottomLeft" => margin,
        "TopCenter" | "Center" | "BottomCenter" => (base_w.saturating_sub(item_w)) / 2,
        _ => base_w.saturating_sub(item_w + margin),
    };

    let y = match pos {
        "TopLeft" | "TopCenter" | "TopRight" => margin,
        "CenterLeft" | "Center" | "CenterRight" => (base_h.saturating_sub(item_h)) / 2,
        _ => base_h.saturating_sub(item_h + margin),
    };

    (x, y)
}
