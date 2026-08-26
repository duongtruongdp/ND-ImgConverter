use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize)]#[serde(rename_all="camelCase")] pub struct VideoInfo { pub path: String, pub duration: f64, pub width: u32, pub height: u32, pub codec: String }
#[derive(Debug, Deserialize)]#[serde(rename_all="camelCase")] pub struct GifOptions { pub input_path: String, pub in_point: f64, pub out_point: f64, pub width: u32, pub fps: u32, pub quality: u8, pub output_directory: Option<String> }

fn tool(name: &str) -> String {
  if let Ok(custom) = std::env::var(format!("ND_{}", name.to_uppercase())) { return custom; }
  let candidates = if name == "ffmpeg" { vec!["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"] } else { vec!["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"] };
  candidates.into_iter().find(|path| *path == name || Path::new(path).is_file()).unwrap_or(name).into()
}
pub fn probe(path: &str) -> Result<VideoInfo, String> {
  let out = Command::new(tool("ffprobe")).args(["-v","error","-select_streams","v:0","-show_entries","stream=codec_name,width,height,duration","-of","json",path]).output().map_err(|e| format!("ffprobe unavailable: {e}"))?;
  if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).trim().to_string()); }
  let root: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?; let s=&root["streams"][0];
  Ok(VideoInfo { path: path.into(), duration: s["duration"].as_str().and_then(|v|v.parse().ok()).or_else(||s["duration"].as_f64()).unwrap_or(0.0), width:s["width"].as_u64().unwrap_or(0) as u32, height:s["height"].as_u64().unwrap_or(0) as u32, codec:s["codec_name"].as_str().unwrap_or("unknown").into() })
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
