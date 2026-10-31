use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub codec: String,
    pub fps: Option<f64>,
    pub frame_rate_mode: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifOptions {
    pub input_path: String,
    pub in_point: f64,
    pub out_point: f64,
    pub width: u32,
    pub fps: u32,
    pub quality: u8,
    pub output_directory: Option<String>,
    pub output_filename: Option<String>,
}
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoConvertOptions {
    pub input_path: String,
    pub output_format: String,
    pub video_codec: String,
    pub quality: u8,
    pub audio: bool,
    pub output_directory: Option<String>,
    pub force_cfr: bool,
    pub target_fps: Option<f64>,
    pub output_filename: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StillOptions {
    pub input_path: String,
    pub timestamp: f64,
    pub output_format: String,
    pub quality: u8,
    pub output_directory: Option<String>,
}

pub(crate) fn resource_path(relative: &str) -> Option<String> {
    crate::runtime::resource_path(relative)
}

pub(crate) fn tool(name: &str) -> Result<String, String> {
    let kind = match name {
        "ffmpeg" => crate::runtime::BinaryKind::Ffmpeg,
        "ffprobe" => crate::runtime::BinaryKind::Ffprobe,
        "yt-dlp" => crate::runtime::BinaryKind::YtDlp,
        "gallery-dl" => crate::runtime::BinaryKind::GalleryDl,
        "bgutil-pot" => crate::runtime::BinaryKind::BgutilPot,
        _ => return Err(format!("Unknown runtime binary: {name}")),
    };
    crate::runtime::resolve_path(kind)
}
pub fn probe(path: &str) -> Result<VideoInfo, String> {
    let ffprobe = tool("ffprobe")?;
    let out = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height,duration,avg_frame_rate,r_frame_rate,nb_frames:format=duration",
            "-of",
            "json",
            path,
        ])
        .output()
        .map_err(|e| format!("ffprobe unavailable: {e}"))?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "FFprobe could not read this video".into()
        } else {
            detail
        });
    }
    let root: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let s = &root["streams"][0];
    let fps = s["avg_frame_rate"].as_str().and_then(|value| {
        let mut parts = value.split('/');
        let numerator: f64 = parts.next()?.parse().ok()?;
        let denominator: f64 = parts.next()?.parse().ok()?;
        (denominator > 0.0).then_some(numerator / denominator)
    });
    let r_fps = s["r_frame_rate"].as_str().and_then(parse_ratio);
    let frame_rate_mode = match (fps, r_fps) {
        (Some(avg), Some(raw)) if (avg - raw).abs() > 0.01 => "vfr",
        (Some(_), Some(_)) => "cfr",
        _ => "unknown",
    };
    Ok(VideoInfo {
        path: path.into(),
        duration: s["duration"]
            .as_str()
            .and_then(|v| v.parse().ok())
            .or_else(|| s["duration"].as_f64())
            .or_else(|| {
                root["format"]["duration"]
                    .as_str()
                    .and_then(|v| v.parse().ok())
            })
            .or_else(|| root["format"]["duration"].as_f64())
            .unwrap_or(0.0),
        width: s["width"].as_u64().unwrap_or(0) as u32,
        height: s["height"].as_u64().unwrap_or(0) as u32,
        codec: s["codec_name"].as_str().unwrap_or("unknown").into(),
        fps,
        frame_rate_mode: frame_rate_mode.into(),
    })
}

fn parse_ratio(value: &str) -> Option<f64> {
    let mut parts = value.split('/');
    let numerator: f64 = parts.next()?.parse().ok()?;
    let denominator: f64 = parts.next()?.parse().ok()?;
    (denominator > 0.0).then_some(numerator / denominator)
}

pub fn extract_still(options: StillOptions) -> Result<String, String> {
    let input = Path::new(&options.input_path);
    if !input.exists() {
        return Err("Input video not found".into());
    }
    if !options.timestamp.is_finite() || options.timestamp < 0.0 {
        return Err("Invalid frame timestamp".into());
    }
    let format = match options.output_format.as_str() {
        "jpeg" | "jpg" => "jpg",
        "png" => "png",
        "webp" => "webp",
        _ => return Err("Unsupported still format".into()),
    };
    let dir = options
        .output_directory
        .map(PathBuf::from)
        .unwrap_or_else(|| input.parent().unwrap_or(Path::new(".")).to_path_buf());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = input
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("frame");
    let stamp = format!("{:.3}", options.timestamp).replace('.', "_");
    let mut index = 0;
    let output = loop {
        let name = if index == 0 {
            format!("{stem}-frame-{stamp}.{format}")
        } else {
            format!("{stem}-frame-{stamp}-{index}.{format}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            break candidate;
        }
        index += 1;
    };
    let quality = options.quality.clamp(1, 100);
    let ffmpeg = tool("ffmpeg")?;
    let mut command = Command::new(ffmpeg);
    command.args([
        "-y",
        "-ss",
        &options.timestamp.to_string(),
        "-i",
        &options.input_path,
        "-frames:v",
        "1",
    ]);
    if format == "jpg" {
        command.args([
            "-q:v",
            &((31 - (quality as u32 * 29 / 100)).max(2)).to_string(),
        ]);
    } else if format == "webp" {
        command.args(["-q:v", &quality.to_string()]);
    }
    let status = command
        .arg(output.to_string_lossy().as_ref())
        .status()
        .map_err(|e| format!("ffmpeg unavailable: {e}"))?;
    if !status.success() {
        return Err("FFmpeg failed to extract the frame".into());
    }
    Ok(output.to_string_lossy().into())
}
#[allow(dead_code)]
pub fn export(options: GifOptions, cancel: Arc<AtomicBool>) -> Result<String, String> {
    export_with_progress(options, cancel, |_| {})
}

pub fn export_with_progress<F>(
    options: GifOptions,
    cancel: Arc<AtomicBool>,
    mut on_progress: F,
) -> Result<String, String>
where
    F: FnMut(f64),
{
    if options.in_point < 0.0
        || options.out_point <= options.in_point
        || options.width == 0
        || options.fps == 0
    {
        return Err("Invalid trim or GIF settings".into());
    }
    let input = Path::new(&options.input_path);
    if !input.exists() {
        return Err("Input video not found".into());
    }
    let dir = options
        .output_directory
        .map(PathBuf::from)
        .unwrap_or_else(|| input.parent().unwrap_or(Path::new(".")).to_path_buf());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = input
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("output");
    let requested_name = options.output_filename.as_deref().unwrap_or("").trim();
    let filename = if requested_name.is_empty() {
        safe_gif_filename(&format!("{stem}.gif"))?
    } else {
        safe_gif_filename(requested_name)?
    };
    let output = next_available_path(&dir, &filename);
    let temporary_output = temporary_path(&output);
    let duration = options.out_point - options.in_point;
    let vf = format!(
        "fps={},scale={}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors={}[p];[s1][p]paletteuse=dither=sierra2_4a",
        options.fps,
        options.width,
        gif_palette_colors(options.quality)
    );
    let ffmpeg = tool("ffmpeg")?;
    let mut child = Command::new(ffmpeg)
        .args([
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-i",
            &options.input_path,
            "-ss",
            &options.in_point.to_string(),
            "-t",
            &duration.to_string(),
            "-vf",
            &vf,
            "-loop",
            "0",
            "-f",
            "gif",
            "-progress",
            "pipe:2",
            temporary_output.to_str().unwrap_or("output.gif.part"),
        ])
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg unavailable: {e}"))?;
    let (progress_sender, progress_receiver) = mpsc::channel();
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                let _ = progress_sender.send(line);
            }
        });
    }
    on_progress(0.0);
    loop {
        while let Ok(line) = progress_receiver.try_recv() {
            if let Some(progress) = parse_ffmpeg_progress(&line, duration) {
                on_progress(progress);
            }
        }
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&temporary_output);
            return Err("GIF rendering cancelled".into());
        }
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => break,
            Some(_) => {
                let _ = std::fs::remove_file(&temporary_output);
                return Err("FFmpeg failed to export GIF".into());
            }
            None => std::thread::sleep(std::time::Duration::from_millis(80)),
        }
    }
    on_progress(1.0);
    std::fs::rename(&temporary_output, &output).map_err(|e| {
        let _ = std::fs::remove_file(&temporary_output);
        format!("Could not finalize GIF output: {e}")
    })?;
    Ok(output.to_string_lossy().into())
}

fn parse_ffmpeg_progress(line: &str, duration: f64) -> Option<f64> {
    let raw = line
        .strip_prefix("out_time_us=")
        .or_else(|| line.strip_prefix("out_time_ms="))?;
    let value = raw.parse::<f64>().ok()?;
    let seconds = if line.starts_with("out_time_us=") {
        value / 1_000_000.0
    } else {
        value / 1_000_000.0
    };
    Some((seconds / duration.max(0.001)).clamp(0.0, 1.0))
}

fn gif_palette_colors(quality: u8) -> u32 {
    32 + (quality.clamp(1, 100) as u32 * 224 / 100)
}

fn safe_gif_filename(filename: &str) -> Result<String, String> {
    if filename.is_empty()
        || filename == "."
        || filename == ".."
        || filename.ends_with(' ')
        || filename.ends_with('.')
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || filename.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
    {
        return Err("GIF filename must be a simple file name".into());
    }
    let filename = if filename.to_ascii_lowercase().ends_with(".gif") {
        filename.to_string()
    } else {
        format!("{filename}.gif")
    };
    Ok(filename)
}

fn next_available_path(directory: &Path, filename: &str) -> PathBuf {
    let candidate = directory.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output");
    let extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("gif");
    (1..)
        .map(|index| directory.join(format!("{stem}-{index}.{extension}")))
        .find(|path| !path.exists())
        .unwrap_or(candidate)
}

fn temporary_path(output: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    output.with_file_name(format!(
        ".{}.part-{}-{stamp}",
        output
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("output.gif"),
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        export, export_with_progress, gif_palette_colors, next_available_path, safe_gif_filename,
        tool, GifOptions,
    };
    use std::path::Path;
    use std::process::Command;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[test]
    fn accepts_simple_gif_names_and_adds_extension() {
        assert_eq!(safe_gif_filename("clip-001").unwrap(), "clip-001.gif");
        assert_eq!(safe_gif_filename("clip.GIF").unwrap(), "clip.GIF");
    }

    #[test]
    fn gif_quality_maps_to_a_bounded_palette() {
        assert_eq!(gif_palette_colors(0), 34);
        assert_eq!(gif_palette_colors(50), 144);
        assert_eq!(gif_palette_colors(100), 256);
        assert_eq!(gif_palette_colors(255), 256);
    }

    #[test]
    fn rejects_path_traversal_in_gif_names() {
        assert!(safe_gif_filename("../clip.gif").is_err());
        assert!(safe_gif_filename("nested/clip.gif").is_err());
    }

    #[test]
    fn chooses_a_collision_safe_path() {
        let directory = std::env::temp_dir().join(format!("nd-gif-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("clip.gif"), b"existing").unwrap();
        assert_eq!(
            next_available_path(&directory, "clip.gif")
                .file_name()
                .unwrap(),
            "clip-1.gif"
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn renders_multiple_gifs_from_one_fixture_and_cleans_cancelled_output() {
        let Ok(ffmpeg) = tool("ffmpeg") else {
            eprintln!("skipping FFmpeg fixture test: FFmpeg is unavailable");
            return;
        };
        let Ok(ffprobe) = tool("ffprobe") else {
            eprintln!("skipping FFmpeg fixture test: FFprobe is unavailable");
            return;
        };
        let directory =
            std::env::temp_dir().join(format!("nd-gif-fixture-{}-é", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let input = directory.join("fixture source 你好.mp4");
        let generated = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=160x90:rate=30",
                "-t",
                "3",
                "-pix_fmt",
                "yuv420p",
                input.to_str().unwrap(),
            ])
            .status()
            .unwrap();
        assert!(generated.success(), "fixture video generation failed");

        let cancel = Arc::new(AtomicBool::new(false));
        let jobs = [
            ("clip one.gif", 0.2, 1.1, 80, 10),
            ("clip two.gif", 0.8, 2.0, 96, 12),
            ("clip three.gif", 1.2, 1.8, 112, 15),
        ];
        let mut outputs = Vec::new();
        let mut progress_samples = Vec::new();
        for (index, (name, in_point, out_point, width, fps)) in jobs.into_iter().enumerate() {
            let options = GifOptions {
                input_path: input.to_string_lossy().into_owned(),
                in_point,
                out_point,
                width,
                fps,
                quality: 80,
                output_directory: Some(directory.to_string_lossy().into_owned()),
                output_filename: Some(name.into()),
            };
            let output = if index == 0 {
                export_with_progress(options, cancel.clone(), |progress| {
                    progress_samples.push(progress)
                })
            } else {
                export(options, cancel.clone())
            }
            .unwrap();
            let bytes = std::fs::read(&output).unwrap();
            assert!(bytes.starts_with(b"GIF8"), "output is not a GIF: {output}");
            let probe = Command::new(&ffprobe)
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=width:format=duration",
                    "-of",
                    "json",
                    &output,
                ])
                .output()
                .unwrap();
            assert!(probe.status.success(), "FFprobe rejected output: {output}");
            let metadata: serde_json::Value = serde_json::from_slice(&probe.stdout).unwrap();
            assert_eq!(metadata["streams"][0]["width"].as_u64(), Some(width as u64));
            let duration = metadata["format"]["duration"]
                .as_str()
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(0.0);
            assert!(
                duration >= (out_point - in_point) - 0.2
                    && duration <= (out_point - in_point) + 0.2
            );
            outputs.push(output);
        }
        assert_eq!(outputs.len(), 3);
        assert_eq!(progress_samples.first().copied(), Some(0.0));
        assert_eq!(progress_samples.last().copied(), Some(1.0));
        assert!(progress_samples.windows(2).all(|pair| pair[0] <= pair[1]));
        assert!(outputs.iter().all(|output| Path::new(output).exists()));
        assert!(!std::fs::read_dir(&directory).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".gif.part")
        }));

        let collision = export(
            GifOptions {
                input_path: input.to_string_lossy().into_owned(),
                in_point: 0.2,
                out_point: 1.1,
                width: 80,
                fps: 10,
                quality: 80,
                output_directory: Some(directory.to_string_lossy().into_owned()),
                output_filename: Some("clip one.gif".into()),
            },
            cancel.clone(),
        )
        .unwrap();
        assert!(collision.ends_with("clip one-1.gif"));

        let missing = export(
            GifOptions {
                input_path: directory.join("missing.mp4").to_string_lossy().into_owned(),
                in_point: 0.0,
                out_point: 1.0,
                width: 80,
                fps: 10,
                quality: 80,
                output_directory: Some(directory.to_string_lossy().into_owned()),
                output_filename: Some("failed.gif".into()),
            },
            cancel.clone(),
        );
        assert!(missing.is_err());
        assert!(outputs.iter().all(|output| Path::new(output).exists()));

        cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        let cancelled = export(
            GifOptions {
                input_path: input.to_string_lossy().into_owned(),
                in_point: 0.0,
                out_point: 2.0,
                width: 80,
                fps: 10,
                quality: 80,
                output_directory: Some(directory.to_string_lossy().into_owned()),
                output_filename: Some("cancelled.gif".into()),
            },
            cancel,
        );
        assert!(cancelled.unwrap_err().contains("cancelled"));
        assert!(!directory.join("cancelled.gif").exists());
        assert!(!std::fs::read_dir(&directory).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("cancelled.gif.part")));
        let _ = std::fs::remove_dir_all(directory);
    }
}

pub fn convert(options: VideoConvertOptions) -> Result<String, String> {
    let input = Path::new(&options.input_path);
    if !input.exists() {
        return Err("Input video not found".into());
    }
    let dir = options
        .output_directory
        .map(PathBuf::from)
        .unwrap_or_else(|| input.parent().unwrap_or(Path::new(".")).to_path_buf());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = input
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("output");
    let filename = options
        .output_filename
        .clone()
        .unwrap_or_else(|| format!("{stem}.{}", options.output_format));
    let output = dir.join(filename);
    let codec = match options.video_codec.as_str() {
        "h264" => "libx264",
        "h265" => "libx265",
        "vp8" => "libvpx",
        "vp9" => "libvpx-vp9",
        "av1" => "libaom-av1",
        _ => return Err("Unsupported video codec".into()),
    };
    let crf = ((100 - options.quality.min(100)) * 3 / 2 + 18).to_string();
    let mut args = vec![
        "-y".into(),
        "-i".into(),
        options.input_path,
        "-c:v".into(),
        codec.into(),
        "-crf".into(),
        crf,
        "-b:v".into(),
        "0".into(),
    ];
    if options.output_format == "webm" {
        args.extend(["-deadline".into(), "good".into()]);
    }
    if options.force_cfr {
        let fps = options
            .target_fps
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or("A valid target FPS is required for CFR conversion")?;
        args.extend([
            "-r".into(),
            fps.to_string(),
            "-fps_mode".into(),
            "cfr".into(),
        ]);
    }
    if options.audio {
        args.extend([
            "-c:a".into(),
            if options.output_format == "webm" {
                "libopus".into()
            } else {
                "aac".into()
            },
        ]);
    } else {
        args.push("-an".into());
    }
    if options.output_filename.is_some() && output.exists() {
        return Err(format!("Output already exists: {}", output.display()));
    }
    args.push(output.to_string_lossy().into());
    let ffmpeg = tool("ffmpeg")?;
    let status = Command::new(ffmpeg)
        .args(args)
        .status()
        .map_err(|e| format!("ffmpeg unavailable: {e}"))?;
    if !status.success() {
        return Err("FFmpeg failed to convert the video".into());
    }
    Ok(output.to_string_lossy().into())
}
