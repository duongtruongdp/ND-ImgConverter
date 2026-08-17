// src-tauri/src/watermark.rs
use image::{imageops, DynamicImage, GenericImageView, Rgba, RgbaImage};
use imageproc::drawing::draw_text_mut;
use rusttype::{Font, Scale};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WatermarkPosition {
    TopLeft,
    TopCenter,
    TopRight,
    CenterLeft,
    Center,
    CenterRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatermarkConfig {
    pub enabled: bool,
    pub is_text: bool,
    pub text_content: Option<String>,
    pub image_path: Option<String>,
    pub position: WatermarkPosition,
    pub opacity: f32,       // 0.1 -> 1.0
    pub scale_percent: f32, // % width relative to the original image (e.g. 15.0%)
    pub margin_px: u32,
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
            let mut rgba_img = base_img.to_rgba8();
            // Font Roboto / Inter
            let font_data = include_bytes!("../assets/Roboto-Bold.ttf");
            let font = Font::try_from_vec(font_data.to_vec())
                .ok_or_else(|| "Failed to load embedded font".to_string())?;

            let scale = Scale::uniform((base_h as f32 * (config.scale_percent / 100.0)).max(16.0));
            let alpha = (config.opacity * 255.0) as u8;
            let color = Rgba([255, 255, 255, alpha]);

            // Calculate x and y coordinates
            let (x, y) = calculate_coordinates(
                config.position.clone(),
                base_w,
                base_h,
                (scale.x * text.len() as f32 * 0.5) as u32,
                scale.y as u32,
                config.margin_px,
            );

            draw_text_mut(&mut rgba_img, color, x as i32, y as i32, scale, &font, text);
            *base_img = DynamicImage::ImageRgba8(rgba_img);
        }
    } else if let Some(logo_path) = &config.image_path {
        if let Ok(mut logo) = image::open(logo_path) {
            let target_w = ((base_w as f32 * (config.scale_percent / 100.0)) as u32).max(10);
            let target_h = ((logo.height() as f32 / logo.width() as f32) * target_w as f32) as u32;

            let resized_logo = logo.resize_exact(target_w, target_h, imageops::FilterType::Lanczos3);
            let mut logo_rgba = resized_logo.to_rgba8();

            // Apply opacity to the Alpha channel
            for pixel in logo_rgba.pixels_mut() {
                pixel[3] = ((pixel[3] as f32) * config.opacity) as u8;
            }

            let (x, y) = calculate_coordinates(
                config.position.clone(),
                base_w,
                base_h,
                target_w,
                target_h,
                config.margin_px,
            );

            imageops::overlay(base_img, &logo_rgba, x as i64, y as i64);
        }
    }

    Ok(())
}

fn calculate_coordinates(
    pos: WatermarkPosition,
    base_w: u32,
    base_h: u32,
    item_w: u32,
    item_h: u32,
    margin: u32,
) -> (u32, u32) {
    match pos {
        WatermarkPosition::TopLeft => (margin, margin),
        WatermarkPosition::TopCenter => ((base_w.saturating_sub(item_w)) / 2, margin),
        WatermarkPosition::TopRight => (base_w.saturating_sub(item_w + margin), margin),
        WatermarkPosition::CenterLeft => (margin, (base_h.saturating_sub(item_h)) / 2),
        WatermarkPosition::Center => (
            (base_w.saturating_sub(item_w)) / 2,
            (base_h.saturating_sub(item_h)) / 2,
        ),
        WatermarkPosition::CenterRight => (
            base_w.saturating_sub(item_w + margin),
            (base_h.saturating_sub(item_h)) / 2,
        ),
        WatermarkPosition::BottomLeft => (margin, base_h.saturating_sub(item_h + margin)),
        WatermarkPosition::BottomCenter => (
            (base_w.saturating_sub(item_w)) / 2,
            base_h.saturating_sub(item_h + margin),
        ),
        WatermarkPosition::BottomRight => (
            base_w.saturating_sub(item_w + margin),
            base_h.saturating_sub(item_h + margin),
        ),
    }
}