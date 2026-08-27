use std::fs::File;
use std::io::{BufWriter, Cursor};
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
            let bpp = 0.05 + (q / 100.0).powf(2.2) * 0.65;
            ((pixels * bpp) / 8.0) as u64
        }
        OutputFormat::Png => ((pixels * 1.5) / 8.0) as u64,
        OutputFormat::Bmp => (pixels * 3.0) as u64 + 54,
        OutputFormat::Tiff => (pixels * 3.0) as u64 + 1024,
        _ => (pixels * 0.35) as u64,
    }
}

fn write_single_image_pdf(image: &DynamicImage, output_path: &Path, quality: u8) -> Result<(), EngineError> {
    let rgb = image.to_rgb8();
    let (width, height) = rgb.dimensions();
    let mut jpeg = Vec::new();
    let encoder = JpegEncoder::new_with_quality(Cursor::new(&mut jpeg), quality.clamp(1, 100));
    DynamicImage::ImageRgb8(rgb)
        .write_with_encoder(encoder)
        .map_err(|error| EngineError::EncodeFailed(format!("PDF image encoding failed: {error}")))?;

    let page_width = width as f32;
    let page_height = height as f32;
    let content = format!("q\n{} 0 0 {} 0 0 cm\n/Im0 Do\nQ\n", page_width, page_height);
    let objects = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>", page_width, page_height).into_bytes(),
        format!("<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n", width, height, jpeg.len()).into_bytes(),
        format!("<< /Length {} >>\nstream\n{}endstream", content.len(), content).into_bytes(),
    ];

    let mut pdf = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        pdf.extend_from_slice(object);
        if index == 3 {
            pdf.extend_from_slice(&jpeg);
            pdf.extend_from_slice(b"\nendstream");
        }
        pdf.extend_from_slice(b"\nendobj\n");
    }
    let xref_offset = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets { pdf.extend_from_slice(format!("{:010} 00000 n \n", offset).as_bytes()); }
    pdf.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n", objects.len() + 1, xref_offset).as_bytes());
    std::fs::write(output_path, pdf).map_err(|error| EngineError::EncodeFailed(format!("PDF write failed: {error}")))
}

// Find and extract the largest embedded JPEG preview from a RAW/DNG file
fn extract_largest_embedded_jpeg(data: &[u8]) -> Option<DynamicImage> {
    let mut largest_img: Option<DynamicImage> = None;
    let mut max_pixels: u64 = 0;
    let len = data.len();

    let mut i = 0;
    while i < len.saturating_sub(4) {
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            if let Ok(img) = image::load_from_memory(&data[i..]) {
                let pixels = (img.width() as u64) * (img.height() as u64);
                if pixels > max_pixels && (img.width() > 500 || img.height() > 500) {
                    max_pixels = pixels;
                    largest_img = Some(img);
                }
            }
            i += 1024;
        } else {
            i += 1;
        }
    }

    largest_img
}

// Bayer CFA to RGB demosaicing with Rec.709/sRGB curve
fn demosaic_bayer_to_rgb(raw: &rawloader::RawImage) -> Option<DynamicImage> {
    let width = raw.width;
    let height = raw.height;

    if let rawloader::RawImageData::Integer(ref data) = raw.data {
        let mut rgb = vec![0u8; width * height * 3];

        let black = raw.blacklevels[0] as f32;
        let white = if raw.whitelevels[0] > raw.blacklevels[0] {
            raw.whitelevels[0] as f32
        } else {
            16383.0
        };
        let range = (white - black).max(1.0);

        for y in 0..height {
            for x in 0..width {
                let idx = y * width + x;
                let val = data[idx] as f32;
                let norm = ((val - black) / range).clamp(0.0, 1.0);
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

    // 1. HEIC / HEIF Multi-Platform Fast-Path
    if ext == "heic" || ext == "heif" {
        #[cfg(target_os = "macos")]
        {
            let unique_id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let temp_file = std::env::temp_dir().join(format!("nd_heic_{}.png", unique_id));

            let status = std::process::Command::new("sips")
                .args([
                    "-s", "format", "png",
                    input_path.to_str().unwrap_or(""),
                    "--out", temp_file.to_str().unwrap_or("")
                ])
                .output();

            if let Ok(out) = status {
                if out.status.success() && temp_file.exists() {
                    let img_res = image::open(&temp_file);
                    let _ = std::fs::remove_file(&temp_file);
                    if let Ok(img) = img_res {
                        return Ok(img);
                    }
                }
            }
            let _ = std::fs::remove_file(&temp_file);
        }

        // Fallback for Windows / other platforms
        if let Ok(file_data) = std::fs::read(input_path) {
            if let Ok(img) = image::load_from_memory(&file_data) {
                return Ok(img);
            }
            if let Some(embedded) = extract_largest_embedded_jpeg(&file_data) {
                return Ok(embedded);
            }
        }

        return Err(EngineError::DecodeFailed(
            "Cannot decode HEIC image format on this system.".into(),
        ));
    }

    // 2. Vector SVG
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

    // 3. Camera RAW (CR2, CR3, DNG, ARW, NEF, ORF, RAF...)
    let raw_extensions = ["arw", "cr2", "cr3", "crw", "dng", "nef", "orf", "pef", "raf", "rw2", "sr2", "srf"];
    if raw_extensions.contains(&ext.as_str()) {
        let file_data = std::fs::read(input_path)?;

        if let Some(embedded) = extract_largest_embedded_jpeg(&file_data) {
            return Ok(embedded);
        }

        if let Ok(raw_image) = rawloader::decode_file(input_path) {
            if let Some(debayered) = demosaic_bayer_to_rgb(&raw_image) {
                return Ok(debayered);
            }
        }
    }

    // 4. Standard raster formats (JPG, PNG, WebP, TIFF, BMP...)
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
    if !options.format.is_supported_output() {
        return Err(EngineError::UnsupportedOutputFormat(
            options.format.display_name().to_string(),
        ));
    }

    // 1. Decode
    let mut current_img = decode_any_image(input_path)?;

    // 2. Watermark Overlay
    if let Some(ref wm_config) = options.watermark {
        if wm_config.enabled {
            let _ = crate::watermark::apply_watermark(&mut current_img, wm_config);
        }
    }

    // 3. Resize
    let resized_img = apply_resize(current_img, options);

    // 4. Color Transform
    let target_color_space = options.color_space.clone().unwrap_or(TargetColorSpace::Srgb);
    let processed_img = apply_color_transform(resized_img, &target_color_space, None);

    // 5. Locate the file storage path
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
        OutputFormat::Tiff => "tif",
        OutputFormat::Tga => "tga",
        OutputFormat::Gif => "gif",
        OutputFormat::Exr => "exr",
        OutputFormat::Pbm => "pbm",
        OutputFormat::Pdf => "pdf",
        OutputFormat::Icns | OutputFormat::Psd | OutputFormat::Dds | OutputFormat::Jp2
        | OutputFormat::Ktx | OutputFormat::Pvr | OutputFormat::Astc => unreachable!("unsupported output format was rejected above"),
    };

    let output_path = parent_dir.join(format!("{}.{}", file_stem, new_ext));

    // 6. Encode
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
        OutputFormat::Pdf => {
            write_single_image_pdf(&processed_img, &output_path, options.quality)?;
        }
        OutputFormat::Avif | OutputFormat::Gif | OutputFormat::Pbm => {
            processed_img
                .save(&output_path)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Exr => {
            let rgba = processed_img.to_rgba8();
            let (width, height) = rgba.dimensions();
            let float_image = ImageBuffer::from_fn(width, height, |x, y| {
                let pixel = rgba.get_pixel(x, y);
                Rgba([
                    pixel[0] as f32 / 255.0,
                    pixel[1] as f32 / 255.0,
                    pixel[2] as f32 / 255.0,
                    pixel[3] as f32 / 255.0,
                ])
            });
            DynamicImage::ImageRgba32F(float_image)
                .save(&output_path)
                .map_err(|e| EngineError::EncodeFailed(e.to_string()))?;
        }
        OutputFormat::Icns | OutputFormat::Psd | OutputFormat::Dds | OutputFormat::Jp2
        | OutputFormat::Ktx | OutputFormat::Pvr | OutputFormat::Astc => unreachable!("unsupported output format was rejected above"),
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
