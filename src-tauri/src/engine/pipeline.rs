use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use image::{codecs::jpeg::JpegEncoder, codecs::png::PngEncoder, imageops::FilterType, ImageReader};
use webp::Encoder as WebpEncoder;

use crate::engine::resize::apply_resize;
use crate::errors::EngineError;
use crate::models::conversion::{ConversionOptions, ConversionResult, ImageMetadata, OutputFormat};

pub fn process_single_image(
    input_path_str: &str,
    options: &ConversionOptions,
) -> Result<ConversionResult, EngineError> {
    let input_path = Path::new(input_path_str);
    if !input_path.exists() {
        return Err(EngineError::FileNotFound(input_path_str.to_string()));
    }

    let img = ImageReader::open(input_path)?
        .with_guessed_format()
        .map_err(|e| EngineError::DecodeFailed(e.to_string()))?
        .decode()
        .map_err(|e| EngineError::DecodeFailed(e.to_string()))?;

    let processed_img = apply_resize(img, options);

    let parent_dir = if let Some(ref dir) = options.output_directory {
        if !dir.trim().is_empty() {
            PathBuf::from(dir)
        } else {
            input_path.parent().unwrap_or(Path::new("")).to_path_buf()
        }
    } else {
        input_path.parent().unwrap_or(Path::new("")).to_path_buf()
    };

    let file_stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");

    let new_ext = match options.format {
        OutputFormat::Jpeg => "jpg",
        OutputFormat::Png => "png",
        OutputFormat::Webp => "webp",
    };

    let output_path = parent_dir.join(format!("{}.{}", file_stem, new_ext));

    match options.format {
        OutputFormat::Jpeg => {
            let output_file = File::create(&output_path)?;
            let writer = BufWriter::new(output_file);
            let mut encoder = JpegEncoder::new_with_quality(writer, options.quality.clamp(1, 100));
            encoder
                .encode_image(&processed_img)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Png => {
            let output_file = File::create(&output_path)?;
            let writer = BufWriter::new(output_file);
            let encoder = PngEncoder::new(writer);
            processed_img
                .write_with_encoder(encoder)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Webp => {
            let rgba = processed_img.to_rgba8();
            let (w, h) = rgba.dimensions();
            let encoder = WebpEncoder::from_rgba(&rgba, w, h);
            let memory = encoder.encode(options.quality as f32);
            std::fs::write(&output_path, &*memory)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
    }

    let output_size = std::fs::metadata(&output_path)?.len();

    Ok(ConversionResult {
        input_path: input_path_str.to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        output_size,
    })
}

pub fn get_image_metadata(input_path_str: &str) -> Result<ImageMetadata, EngineError> {
    let path = Path::new(input_path_str);
    if !path.exists() {
        return Err(EngineError::FileNotFound(input_path_str.to_string()));
    }

    let file_size = std::fs::metadata(path)?.len();

    let reader = ImageReader::open(path)?
        .with_guessed_format()
        .map_err(|e| EngineError::DecodeFailed(e.to_string()))?;

    let img = reader
        .decode()
        .map_err(|e| EngineError::DecodeFailed(e.to_string()))?;

    let (w, h) = (img.width(), img.height());

    // Dùng FilterType::Nearest để downscale cực nhanh thumbnail
    let thumb = img.resize(96, 96, FilterType::Nearest);
    let thumb_rgba = thumb.to_rgba8();
    let (tw, th) = thumb_rgba.dimensions();
    
    let encoder = WebpEncoder::from_rgba(&thumb_rgba, tw, th);
    let webp_data = encoder.encode(30.0);

    use base64::Engine;
    let base64_str = base64::engine::general_purpose::STANDARD.encode(&*webp_data);
    let thumbnail_base64 = format!("data:image/webp;base64,{}", base64_str);

    Ok(ImageMetadata {
        path: input_path_str.to_string(),
        width: w,
        height: h,
        size: file_size,
        thumbnail_base64,
    })
}