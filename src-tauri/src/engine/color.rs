use image::{DynamicImage, ImageBuffer};
use lcms2::{CIExyY, CIExyYTRIPLE, Intent, PixelFormat, Profile, ToneCurve, Transform};
use crate::models::conversion::TargetColorSpace;

/// Tạo Display P3 Profile bằng chuẩn toạ độ màu CIE D65
fn create_display_p3_profile() -> Profile {
    let white_point = CIExyY {
        x: 0.3127,
        y: 0.3290,
        Y: 1.0,
    };
    let primaries = CIExyYTRIPLE {
        Red: CIExyY { x: 0.680, y: 0.320, Y: 1.0 },
        Green: CIExyY { x: 0.265, y: 0.690, Y: 1.0 },
        Blue: CIExyY { x: 0.150, y: 0.060, Y: 1.0 },
    };
    let curve = ToneCurve::new(2.2);
    let curves = [&curve, &curve, &curve];
    Profile::new_rgb(&white_point, &primaries, &curves).unwrap_or_else(|_| Profile::new_srgb())
}

/// Tạo Adobe RGB (1998) Profile
fn create_adobe_rgb_profile() -> Profile {
    let white_point = CIExyY {
        x: 0.3127,
        y: 0.3290,
        Y: 1.0,
    };
    let primaries = CIExyYTRIPLE {
        Red: CIExyY { x: 0.6400, y: 0.3300, Y: 1.0 },
        Green: CIExyY { x: 0.2100, y: 0.7100, Y: 1.0 },
        Blue: CIExyY { x: 0.1500, y: 0.0600, Y: 1.0 },
    };
    let curve = ToneCurve::new(2.19921875);
    let curves = [&curve, &curve, &curve];
    Profile::new_rgb(&white_point, &primaries, &curves).unwrap_or_else(|_| Profile::new_srgb())
}

/// Chuyển đổi Color Space cho DynamicImage sử dụng Little-CMS2
pub fn apply_color_transform(
    img: DynamicImage,
    target_space: &TargetColorSpace,
    embedded_icc: Option<&[u8]>,
) -> DynamicImage {
    if *target_space == TargetColorSpace::Original && embedded_icc.is_none() {
        return img;
    }

    let src_profile = if let Some(icc_data) = embedded_icc {
        Profile::new_icc(icc_data).unwrap_or_else(|_| Profile::new_srgb())
    } else {
        Profile::new_srgb()
    };

    let dst_profile = match target_space {
        TargetColorSpace::Srgb | TargetColorSpace::Original => Profile::new_srgb(),
        TargetColorSpace::DisplayP3 => create_display_p3_profile(),
        TargetColorSpace::AdobeRgb => create_adobe_rgb_profile(),
    };

    let (width, height) = (img.width(), img.height());

    match img {
        DynamicImage::ImageRgb8(mut rgb_img) => {
            if let Ok(transform) = Transform::new(
                &src_profile,
                PixelFormat::RGB_8,
                &dst_profile,
                PixelFormat::RGB_8,
                Intent::Perceptual,
            ) {
                transform.transform_in_place(&mut rgb_img);
            }
            DynamicImage::ImageRgb8(rgb_img)
        }
        DynamicImage::ImageRgba8(rgba_img) => {
            let mut rgb_raw = Vec::with_capacity((width * height * 3) as usize);
            let mut alpha_channel = Vec::with_capacity((width * height) as usize);

            for pixel in rgba_img.pixels() {
                rgb_raw.push(pixel[0]);
                rgb_raw.push(pixel[1]);
                rgb_raw.push(pixel[2]);
                alpha_channel.push(pixel[3]);
            }

            if let Ok(transform) = Transform::new(
                &src_profile,
                PixelFormat::RGB_8,
                &dst_profile,
                PixelFormat::RGB_8,
                Intent::Perceptual,
            ) {
                transform.transform_in_place(&mut rgb_raw);
            }

            let mut output_rgba = Vec::with_capacity((width * height * 4) as usize);
            for i in 0..(width * height) as usize {
                output_rgba.push(rgb_raw[i * 3]);
                output_rgba.push(rgb_raw[i * 3 + 1]);
                output_rgba.push(rgb_raw[i * 3 + 2]);
                output_rgba.push(alpha_channel[i]);
            }

            if let Some(buf) = ImageBuffer::from_raw(width, height, output_rgba) {
                DynamicImage::ImageRgba8(buf)
            } else {
                DynamicImage::ImageRgba8(rgba_img)
            }
        }
        other => other,
    }
}