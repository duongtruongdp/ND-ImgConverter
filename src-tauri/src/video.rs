use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize)]#[serde(rename_all="camelCase")] pub struct VideoInfo { pub path: String, pub duration: f64, pub width: u32, pub height: u32, pub codec: String, pub fps: Option<f64> }
#[derive(Debug, Deserialize)]#[serde(rename_all="camelCase")] pub struct GifOptions { pub input_path: String, pub in_point: f64, pub out_point: f64, pub width: u32, pub fps: u32, pub quality: u8, pub output_directory: Option<String> }
#[derive(Debug, Deserialize, Clone)]#[serde(rename_all="camelCase")] pub struct VideoConvertOptions { pub input_path: String, pub output_format: String, pub video_codec: String, pub quality: u8, pub audio: bool, pub output_directory: Option<String>, pub force_cfr: bool, pub target_fps: Option<f64>, pub output_filename: Option<String> }
#[derive(Debug, Deserialize)]#[serde(rename_all="camelCase")] pub struct StillOptions { pub input_path: String, pub timestamp: f64, pub output_format: String, pub quality: u8, pub output_directory: Option<String> }

fn tool(name: &str) -> String {
  if let Ok(custom) = std::env::var(format!("ND_{}", name.to_uppercase())) { return custom; }
  if let Some(exe) = std::env::current_exe().ok() {
    if let Some(dir) = exe.parent() {
      let resource_roots = if cfg!(target_os = "macos") {
        vec![dir.join("../Resources"), dir.join("../Resources/resources"), dir.join("resources")]
      } else {
        vec![dir.join("resources"), dir.join("../resources"), dir.join("resources/resources")]
      };
      for root in resource_roots {
        let path = root.join("binaries").join(name);
        if path.is_file() { return path.to_string_lossy().into(); }
      }
    }
  }
  let candidates = if name == "ffmpeg" { vec!["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"] } else { vec!["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"] };
  candidates.into_iter().find(|path| *path == name || Path::new(path).is_file()).unwrap_or(name).into()
}
pub fn probe(path: &str) -> Result<VideoInfo, String> {
  let out = Command::new(tool("ffprobe")).args(["-v","error","-select_streams","v:0","-show_entries","stream=codec_name,width,height,duration","-of","json",path]).output().map_err(|e| format!("ffprobe unavailable: {e}"))?;
  if !out.status.success() {
    let detail = String::from_utf8_lossy(&out.stderr).trim().to_string();
    return Err(if detail.is_empty() { "FFprobe could not read this video".into() } else { detail });
  }
  let root: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?; let s=&root["streams"][0];
  let fps = s["avg_frame_rate"].as_str().and_then(|value| { let mut parts = value.split('/'); let numerator: f64 = parts.next()?.parse().ok()?; let denominator: f64 = parts.next()?.parse().ok()?; (denominator > 0.0).then_some(numerator / denominator) });
  Ok(VideoInfo { path: path.into(), duration: s["duration"].as_str().and_then(|v|v.parse().ok()).or_else(||s["duration"].as_f64()).unwrap_or(0.0), width:s["width"].as_u64().unwrap_or(0) as u32, height:s["height"].as_u64().unwrap_or(0) as u32, codec:s["codec_name"].as_str().unwrap_or("unknown").into(), fps })
}

pub fn extract_still(options: StillOptions) -> Result<String, String> {
  let input = Path::new(&options.input_path);
  if !input.exists() { return Err("Input video not found".into()); }
  if !options.timestamp.is_finite() || options.timestamp < 0.0 { return Err("Invalid frame timestamp".into()); }
  let format = match options.output_format.as_str() { "jpeg" | "jpg" => "jpg", "png" => "png", "webp" => "webp", _ => return Err("Unsupported still format".into()) };
  let dir = options.output_directory.map(PathBuf::from).unwrap_or_else(|| input.parent().unwrap_or(Path::new(".")).to_path_buf());
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let stem = input.file_stem().and_then(|v| v.to_str()).unwrap_or("frame");
  let stamp = format!("{:.3}", options.timestamp).replace('.', "_");
  let mut index = 0;
  let output = loop { let name = if index == 0 { format!("{stem}-frame-{stamp}.{format}") } else { format!("{stem}-frame-{stamp}-{index}.{format}") }; let candidate = dir.join(name); if !candidate.exists() { break candidate; } index += 1; };
  let quality = options.quality.clamp(1, 100);
  let mut command = Command::new(tool("ffmpeg"));
  command.args(["-y", "-ss", &options.timestamp.to_string(), "-i", &options.input_path, "-frames:v", "1"]);
  if format == "jpg" { command.args(["-q:v", &((31 - (quality as u32 * 29 / 100)).max(2)).to_string()]); } else if format == "webp" { command.args(["-q:v", &quality.to_string()]); }
  let status = command.arg(output.to_string_lossy().as_ref()).status().map_err(|e| format!("ffmpeg unavailable: {e}"))?;
  if !status.success() { return Err("FFmpeg failed to extract the frame".into()); }
  Ok(output.to_string_lossy().into())
}
pub fn export(options: GifOptions) -> Result<String, String> {
  if options.in_point < 0.0 || options.out_point <= options.in_point || options.width == 0 || options.fps == 0 { return Err("Invalid trim or GIF settings".into()); }
  let input=Path::new(&options.input_path); if !input.exists(){return Err("Input video not found".into());}
  let dir=options.output_directory.map(PathBuf::from).unwrap_or_else(||input.parent().unwrap_or(Path::new(".")).to_path_buf()); std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
  let stem=input.file_stem().and_then(|v|v.to_str()).unwrap_or("output"); let output=dir.join(format!("{stem}.gif")); let duration=options.out_point-options.in_point;
  let vf=format!("fps={},scale={}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors={}[p];[s1][p]paletteuse=dither=sierra2_4a", options.fps, options.width, 32 + (options.quality as u32 * 224 / 100));
  let status=Command::new(tool("ffmpeg")).args(["-y","-ss",&options.in_point.to_string(),"-i",&options.input_path,"-t",&duration.to_string(),"-vf",&vf,"-loop","0",output.to_str().unwrap_or("output.gif")]).status().map_err(|e|format!("ffmpeg unavailable: {e}"))?;
  if !status.success(){return Err("FFmpeg failed to export GIF".into());} Ok(output.to_string_lossy().into())
}

pub fn convert(options: VideoConvertOptions) -> Result<String, String> {
  let input = Path::new(&options.input_path); if !input.exists() { return Err("Input video not found".into()); }
  let dir = options.output_directory.map(PathBuf::from).unwrap_or_else(|| input.parent().unwrap_or(Path::new(".")).to_path_buf()); std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let stem = input.file_stem().and_then(|v| v.to_str()).unwrap_or("output"); let filename = options.output_filename.clone().unwrap_or_else(|| format!("{stem}.{}", options.output_format)); let output = dir.join(filename);
  let codec = match options.video_codec.as_str() { "h264" => "libx264", "h265" => "libx265", "vp8" => "libvpx", "vp9" => "libvpx-vp9", "av1" => "libaom-av1", _ => return Err("Unsupported video codec".into()) };
  let crf = ((100 - options.quality.min(100)) * 3 / 2 + 18).to_string();
  let mut args = vec!["-y".into(), "-i".into(), options.input_path, "-c:v".into(), codec.into(), "-crf".into(), crf, "-b:v".into(), "0".into()];
  if options.output_format == "webm" { args.extend(["-deadline".into(), "good".into()]); }
  if options.force_cfr {
    let fps = options.target_fps.filter(|value| value.is_finite() && *value > 0.0).ok_or("A valid target FPS is required for CFR conversion")?;
    args.extend(["-r".into(), fps.to_string(), "-fps_mode".into(), "cfr".into()]);
  }
  if options.audio { args.extend(["-c:a".into(), if options.output_format == "webm" { "libopus".into() } else { "aac".into() }]); } else { args.push("-an".into()); }
  if options.output_filename.is_some() && output.exists() { return Err(format!("Output already exists: {}", output.display())); }
  args.push(output.to_string_lossy().into());
  let status = Command::new(tool("ffmpeg")).args(args).status().map_err(|e| format!("ffmpeg unavailable: {e}"))?;
  if !status.success() { return Err("FFmpeg failed to convert the video".into()); } Ok(output.to_string_lossy().into())
}
