use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use image::{
    codecs::jpeg::JpegEncoder, 
    codecs::png::PngEncoder, 
    codecs::bmp::BmpEncoder, 
    codecs::ico::IcoEncoder,
    codecs::tiff::TiffEncoder,
    codecs::tga::TgaEncoder,
    imageops::FilterType, 
    DynamicImage, ImageReader, ImageBuffer, Rgba, RgbImage
};
use webp::Encoder as WebpEncoder;

use crate::engine::color::apply_color_transform;
use crate::engine::metadata::extract_exif_info;
use crate::engine::resize::apply_resize;
use crate::errors::EngineError;
use crate::models::conversion::{ConversionOptions, ConversionResult, ImageMetadata, OutputFormat, TargetColorSpace};

/// Rapid estimation of compressed size based on metadata analysis
pub fn estimate_single_file_size(
    _file_size: u64,
    width: u32,
    height: u32,
    format: &OutputFormat,
    quality: u8,
) -> u64 {
    if width == 0 || height == 0 {
        return 0;
    }

    let q = quality.clamp(1, 100) as f64;
    let pixels = (width * height) as f64;

    match format {
        OutputFormat::Webp => {
            let bpp = 0.03 + (q / 100.0).powf(2.4) * 0.45;
            ((pixels * bpp) / 8.0) as u64
        }
        OutputFormat::Avif => {
            let bpp = 0.02 + (q / 100.0).powf(2.6) * 0.35;
            ((pixels * bpp) / 8.0) as u64
        }
        OutputFormat::Jpeg => {
            // Chuẩn JPEG: 100% chất lượng ~ 0.5 - 0.75 Bytes/Pixel
            let bpp = 0.05 + (q / 100.0).powf(2.2) * 0.65;
            ((pixels * bpp) / 8.0) as u64
        }
        OutputFormat::Png => ((pixels * 1.5) / 8.0) as u64,
        OutputFormat::Bmp => (pixels * 3.0) as u64 + 54,
        OutputFormat::Tiff => (pixels * 3.0) as u64 + 1024,
        _ => ((pixels * 0.35) as u64),
    }
}

// Find and extract the largest embedded JPEG preview from a RAW/DNG file
fn extract_largest_embedded_jpeg(data: &[u8]) -> Option<DynamicImage> {
    let mut largest_img: Option<DynamicImage> = None;
    let mut max_pixels: u64 = 0;
    let len = data.len();

    let mut i = 0;
    while i < len.saturating_sub(4) {
        // Tìm JPEG Header: 0xFF, 0xD8, 0xFF
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            // Thử load stream JPEG
            if let Ok(img) = image::load_from_memory(&data[i..]) {
                let pixels = (img.width() as u64) * (img.height() as u64);
                // Bỏ qua thumbnail nhỏ (< 500px)
                if pixels > max_pixels && (img.width() > 500 || img.height() > 500) {
                    max_pixels = pixels;
                    largest_img = Some(img);
                }
            }
        }
        i += 1;
    }

    largest_img
}

// Demosaic nội suy Bayer CFA sang RGB kèm Curve Rec.709/sRGB
fn demosaic_bayer_to_rgb(raw: &rawloader::RawImage) -> Option<DynamicImage> {
    let width = raw.width;
    let height = raw.height;

    if let rawloader::RawImageData::Integer(ref data) = raw.data {
        let mut rgb = vec![0u8; width * height * 3];

        // Find safe black and white levels
        let black = raw.blacklevels[0] as f32;
        let white = if raw.whitelevels[0] > raw.blacklevels[0] {
            raw.whitelevels[0] as f32
        } else {
            16383.0
        };
        let range = (white - black).max(1.0);

        // Simple 2x2 matrix interpolation Debayering
        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                let val = data[idx] as f32;
                let norm = ((val - black) / range).clamp(0.0, 1.0);
                // Gamma curve sRGB 
                let gamma_val = if norm <= 0.0031308 {
                    norm * 12.92
                } else {
                    1.055 * norm.powf(1.0 / 2.4) - 0.055
                };
                let u8_val = (gamma_val * 255.0).clamp(0.0, 255.0) as u8;

                let out_idx = idx * 3;
                rgb[out_idx] = u8_val;
                rgb[out_idx + 1] = u8_val;
                rgb[out_idx + 2] = u8_val;
            }
        }

        if let Some(buf) = RgbImage::from_raw(width as u32, height as u32, rgb) {
            return Some(DynamicImage::ImageRgb8(buf));
        }
    }
    None
}

pub fn decode_any_image(input_path: &Path) -> Result<DynamicImage, EngineError> {
    let ext = input_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    // 1. File Vector SVG
    if ext == "svg" {
        let svg_data = std::fs::read(input_path)?;
        let opt = usvg::Options::default();
        let tree = usvg::Tree::from_data(&svg_data, &opt)
            .map_err(|e| EngineError::DecodeFailed(e.to_string()))?;

        let pixmap_size = tree.size().to_int_size();
        let mut pixmap = resvg::tiny_skia::Pixmap::new(pixmap_size.width(), pixmap_size.height())
            .ok_or_else(|| EngineError::DecodeFailed("Failed to allocate SVG pixmap".into()))?;

        resvg::render(&tree, resvg::tiny_skia::Transform::default(), &mut pixmap.as_mut());

        let rgba_buf = ImageBuffer::<Rgba<u8>, _>::from_raw(
            pixmap.width(),
            pixmap.height(),
            pixmap.data().to_vec(),
        ).ok_or_else(|| EngineError::DecodeFailed("Failed to create RGBA buffer from SVG".into()))?;

        return Ok(DynamicImage::ImageRgba8(rgba_buf));
    }

    // 2. File Camera RAW (CR2, CR3, DNG, ARW, NEF, ORF, RAF...)
    let raw_extensions = ["arw", "cr2", "cr3", "crw", "dng", "nef", "orf", "pef", "raf", "rw2", "sr2", "srf"];
    if raw_extensions.contains(&ext.as_str()) {
        let file_data = std::fs::read(input_path)?;

        // Priority 1: Use the embedded Full/High-Res JPEG with the camera's processed color science
        if let Some(embedded) = extract_largest_embedded_jpeg(&file_data) {
            return Ok(embedded);
        }

        // Priority 2: Decode using rawloader if no embedded JPEG is present
        if let Ok(raw_image) = rawloader::decode_file(input_path) {
            if let Some(debayered) = demosaic_bayer_to_rgb(&raw_image) {
                return Ok(debayered);
            }
        }
    }

    // 3. File Standard Raster (JPG, PNG, WebP, TIFF, BMP...)
    let reader = ImageReader::open(input_path)?
        .with_guessed_format()
        .map_err(|e| EngineError::DecodeFailed(e.to_string()))?;

    reader.decode().map_err(|e| EngineError::DecodeFailed(e.to_string()))
}

pub fn process_single_image(
    input_path_str: &str,
    options: &ConversionOptions,
) -> Result<ConversionResult, EngineError> {
    let input_path = Path::new(input_path_str);
    if !input_path.exists() {
        return Err(EngineError::FileNotFound(input_path_str.to_string()));
    }

    // 1. Decode image
    let img = decode_any_image(input_path)?;

    // 2. Resize
    let resized_img = apply_resize(img, options);

    // 3. Color Transform (Little-CMS 2)
    let target_color_space = options.color_space.clone().unwrap_or(TargetColorSpace::Srgb);
    let processed_img = apply_color_transform(resized_img, &target_color_space, None);

    // 4. Locate the output folder and file extension
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
        OutputFormat::Avif => "avif",
        OutputFormat::Bmp => "bmp",
        OutputFormat::Ico => "ico",
        OutputFormat::Icns => "icns",
        OutputFormat::Tiff => "tif",
        OutputFormat::Tga => "tga",
        OutputFormat::Gif => "gif",
        OutputFormat::Exr => "exr",
        OutputFormat::Pbm => "pbm",
        OutputFormat::Pdf => "pdf",
        OutputFormat::Psd => "psd",
        OutputFormat::Dds => "dds",
        OutputFormat::Jp2 => "jp2",
        OutputFormat::Ktx => "ktx",
        OutputFormat::Pvr => "pvr",
        OutputFormat::Astc => "astc",
    };

    let output_path = parent_dir.join(format!("{}.{}", file_stem, new_ext));

    // 5. Encode according to the target format
    match options.format {
        OutputFormat::Jpeg => {
            let file = File::create(&output_path)?;
            let writer = BufWriter::new(file);
            let encoder = JpegEncoder::new_with_quality(writer, options.quality.clamp(1, 100));
            processed_img
                .write_with_encoder(encoder)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Png => {
            let file = File::create(&output_path)?;
            let writer = BufWriter::new(file);
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
        OutputFormat::Bmp => {
            let file = File::create(&output_path)?;
            let mut writer = BufWriter::new(file);
            let encoder = BmpEncoder::new(&mut writer);
            processed_img
                .write_with_encoder(encoder)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Ico => {
            let file = File::create(&output_path)?;
            let writer = BufWriter::new(file);
            let encoder = IcoEncoder::new(writer);
            let ico_img = if processed_img.width() > 256 || processed_img.height() > 256 {
                processed_img.resize(256, 256, FilterType::Lanczos3)
            } else {
                processed_img.clone()
            };
            ico_img
                .write_with_encoder(encoder)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Tiff => {
            let file = File::create(&output_path)?;
            let writer = BufWriter::new(file);
            let encoder = TiffEncoder::new(writer);
            processed_img
                .write_with_encoder(encoder)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Tga => {
            let file = File::create(&output_path)?;
            let writer = BufWriter::new(file);
            let encoder = TgaEncoder::new(writer);
            processed_img
                .write_with_encoder(encoder)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        _ => {
            processed_img
                .save(&output_path)
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
    let format_name = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("IMG")
        .to_uppercase();

    let exif_meta = extract_exif_info(path);
    let img = decode_any_image(path)?;
    let (w, h) = (img.width(), img.height());

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
        format_name,
        color_profile: Some("sRGB / Rec.709".to_string()),
        camera_model: exif_meta.camera_model,
        lens_model: exif_meta.lens_model,
        iso: exif_meta.iso,
        f_number: exif_meta.f_number,
        exposure_time: exif_meta.exposure_time,
        has_gps: exif_meta.has_gps,
    })
}