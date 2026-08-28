use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::thread;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadVariant {
    pub format_id: String,
    pub label: String,
    pub resolution: Option<String>,
    pub container: Option<String>,
    pub video_codec: Option<String>,
    pub audio_available: bool,
    pub estimated_filesize: Option<u64>,
    pub height: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadMetadata {
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub uploader: Option<String>,
    pub source: Option<String>,
    pub po_token_provider: Option<String>,
    pub variants: Vec<DownloadVariant>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub format_id: String,
    pub audio_available: bool,
    pub max_height: Option<u64>,
    pub container: Option<String>,
    pub auth_browser: Option<String>,
    pub output_directory: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub url: String,
    pub auth_browser: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub status: String,
    pub percent: Option<f64>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloaderError {
    kind: String,
    message: String,
    details: String,
}

fn plugin_directory() -> Option<String> {
    let configured = std::env::var("ND_YTDLP_PLUGIN_DIR")
        .ok()
        .filter(|path| plugin_layout_exists(std::path::Path::new(path)))
        .or_else(|| crate::video::resource_path("binaries/yt-dlp-plugins"))
        .or_else(|| crate::video::resource_path("yt-dlp-plugins"))
        .filter(|path| plugin_layout_exists(std::path::Path::new(path)));
    configured
}

fn plugin_layout_exists(root: &std::path::Path) -> bool {
    if !root.is_dir() {
        return false;
    }
    [root.to_path_buf(), root.join("bgutil-ytdlp-pot-provider")]
        .into_iter()
        .any(|candidate| candidate.join("yt_dlp_plugins").is_dir())
}

fn pot_provider_path() -> Option<String> {
    std::env::var("ND_BGUTIL_POT")
        .ok()
        .filter(|path| std::path::Path::new(path).is_file())
        .or_else(|| crate::video::resource_path("binaries/bgutil-pot"))
        .or_else(|| crate::video::resource_path("binaries/bgutil-pot.exe"))
        .or_else(|| {
            [
                "/opt/homebrew/bin/bgutil-pot",
                "/usr/local/bin/bgutil-pot",
                "/usr/bin/bgutil-pot",
                "bgutil-pot",
            ]
            .into_iter()
            .find(|path| *path == "bgutil-pot" || std::path::Path::new(path).is_file())
            .map(str::to_string)
        })
}

fn provider_readiness(path: &str) -> String {
    match Command::new(path).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if version.is_empty() {
                "ready".into()
            } else {
                format!("ready ({version})")
            }
        }
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if detail.is_empty() {
                format!("failed (exit {})", output.status)
            } else {
                format!("failed ({})", detail.chars().take(160).collect::<String>())
            }
        }
        Err(error) => format!("failed ({error})"),
    }
}

fn append_provider_args(args: &mut Vec<String>) {
    if let Some(directory) = plugin_directory() {
        args.extend(["--plugin-dirs".into(), directory]);
        if let Some(provider) = pot_provider_path() {
            args.extend([
                "--extractor-args".into(),
                format!("youtubepot-bgutilcli:cli_path={provider}"),
            ]);
        }
    }
}

fn provider_status() -> String {
    match (plugin_directory(), pot_provider_path()) {
        (Some(plugin), Some(provider)) => format!(
            "configured (plugin root: {plugin}; provider: {provider}; {})",
            provider_readiness(&provider)
        ),
        (Some(plugin), None) => format!("provider binary missing (plugin root: {plugin})"),
        (None, _) => "plugin package missing".into(),
    }
}

fn detected_provider(detail: &str) -> Option<String> {
    detail.lines().find_map(|line| {
        line.split_once("PO Token Providers:")
            .map(|(_, value)| value.trim().to_string())
    })
}

fn provider_flow(detail: &str) -> &'static str {
    let lower = detail.to_lowercase();
    if lower.contains("retrieved a gvs po token") {
        "detected -> invoked -> acquired"
    } else if lower.contains("generating a gvs po token")
        || lower.contains("executing command to get pot")
    {
        "detected -> invoked -> acquisition pending/failed"
    } else if detected_provider(detail).is_some() {
        "detected -> not invoked"
    } else {
        "not detected"
    }
}

fn runtime_diagnostics(provider_label: &str) -> String {
    let version = yt_dlp_version();
    format!(
        "yt-dlp path: {}\nyt-dlp source: {}\nyt-dlp version: {} ({})\nplugin root: {}\nbgutil-pot path: {}\nPO Token provider: {}",
        crate::video::tool("yt-dlp"),
        yt_dlp_source(),
        version,
        yt_dlp_version_status(&version),
        plugin_directory().unwrap_or_else(|| "<missing>".into()),
        pot_provider_path().unwrap_or_else(|| "<missing>".into()),
        provider_label,
    )
}

fn error_json(kind: &str, message: &str, details: &str) -> String {
    serde_json::to_string(&DownloaderError {
        kind: kind.into(),
        message: message.into(),
        details: details.chars().take(8000).collect(),
    })
    .unwrap_or_else(|_| message.into())
}

fn sanitize_details(detail: &str) -> String {
    detail
        .lines()
        .filter(|line| {
            let lower = line.to_lowercase();
            !lower.contains("videoplayback")
                && !lower.contains("googlevideo.com")
                && !lower.contains("cookie")
                && !lower.contains("authorization:")
                && !lower.contains("po token:")
        })
        .map(|line| {
            line.split_whitespace()
                .map(|token| {
                    if token.starts_with("http://") || token.starts_with("https://") {
                        if token.contains('?') {
                            token.split('?').next().unwrap_or("[redacted URL]")
                        } else {
                            "[redacted URL]"
                        }
                    } else {
                        token
                    }
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn validate_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) || trimmed.len() <= 8 {
        return Err(error_json(
            "Invalid URL",
            "Please enter a valid http(s) video URL",
            "The URL must start with http:// or https://.",
        ));
    }
    Ok(())
}

fn validate_browser(browser: Option<&str>) -> Result<Option<&'static str>, String> {
    match browser.map(str::trim).filter(|value| !value.is_empty()) {
        None | Some("none") => Ok(None),
        Some("chrome") => Ok(Some("chrome")),
        Some("chromium") => Ok(Some("chromium")),
        Some("edge") => Ok(Some("edge")),
        Some("firefox") => Ok(Some("firefox")),
        Some("safari") => Ok(Some("safari")),
        Some("brave") => Ok(Some("brave")),
        Some(_) => Err(error_json(
            "Invalid browser",
            "Unsupported browser authentication option",
            "Choose a browser from the Authentication list.",
        )),
    }
}

fn append_auth_args(args: &mut Vec<String>, browser: Option<&str>) -> Result<(), String> {
    if let Some(browser) = validate_browser(browser)? {
        args.extend(["--cookies-from-browser".into(), browser.into()]);
    }
    Ok(())
}

fn yt_dlp_version() -> String {
    Command::new(crate::video::tool("yt-dlp"))
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|version| !version.is_empty())
        .unwrap_or_else(|| "unavailable".into())
}

fn yt_dlp_source() -> &'static str {
    if std::env::var_os("ND_YTDLP").is_some() {
        "ND_YTDLP override"
    } else if crate::video::resource_path("binaries/yt-dlp")
        .is_some_and(|path| std::path::Path::new(&path).is_file())
    {
        "bundled yt-dlp"
    } else {
        "system fallback"
    }
}

fn yt_dlp_version_status(version: &str) -> String {
    let expected = option_env!("ND_EXPECTED_YTDLP_VERSION").unwrap_or("unknown");
    if version == expected {
        format!("matches pinned {expected}")
    } else {
        format!("expected {expected}, actual {version}")
    }
}

fn structured_error(detail: &str) -> String {
    let lower = detail.to_lowercase();
    let token_acquired = lower.contains("retrieved a gvs po token");
    let diagnostics = format!(
        "{}\nPO Token flow: {}\nyt-dlp version: {}\n{}",
        runtime_diagnostics(&detected_provider(detail).unwrap_or_else(provider_status)),
        provider_flow(detail),
        yt_dlp_version(),
        sanitize_details(detail).chars().take(8000).collect::<String>()
    );
    if lower.contains("sign in to confirm")
        || lower.contains("not a bot")
        || lower.contains("requires authentication")
    {
        error_json(
            "Authentication required",
            "YouTube requires authentication. Select a browser with an active signed-in session.",
            &diagnostics,
        )
    } else if lower.contains("cookie database")
        || lower.contains("could not copy")
        || lower.contains("failed to decrypt")
    {
        error_json(
            "Browser cookies unavailable",
            "The selected browser cookies could not be read.",
            &diagnostics,
        )
    } else if lower.contains("unsupported url")
        || lower.contains("no suitable extractor")
        || lower.contains("unsupported site")
    {
        error_json(
            "Unsupported URL/site",
            "This URL or site is not supported by yt-dlp.",
            &diagnostics,
        )
    } else if lower.contains("the page needs to be reloaded") {
        error_json(
            "YouTube session refresh required",
            "YouTube rejected the current session. Reload the video page or retry without browser authentication.",
            &diagnostics,
        )
    } else if lower.contains("po token providers: none")
        || lower.contains("po token provider unavailable")
    {
        error_json("PO Token provider unavailable", "This YouTube stream requires a PO Token provider that is not available in this installation.", &diagnostics)
    } else if lower.contains("po token")
        && !token_acquired
        && (lower.contains("failed") || lower.contains("error") || lower.contains("rejected"))
    {
        error_json("PO Token acquisition failed", "YouTube's PO Token could not be acquired for this stream. Try again or choose another quality.", &diagnostics)
    } else if lower.contains("http error 403") || lower.contains("403: forbidden") {
        let message = if lower.contains("po token")
            || lower.contains("player client")
            || lower.contains("sabr")
        {
            "YouTube rejected the selected media stream after analysis, possibly because of PO Token or player-client restrictions. Try another quality."
        } else {
            "Media access denied: the selected video stream was rejected by the source. Try another quality or retry."
        };
        error_json("Media access denied", message, &diagnostics)
    } else if lower.contains("timed out")
        || lower.contains("network is unreachable")
        || lower.contains("unable to download")
        || lower.contains("connection")
    {
        error_json(
            "Network failure",
            "The video could not be reached. Check your network connection and try again.",
            &diagnostics,
        )
    } else {
        error_json(
            "yt-dlp failure",
            "yt-dlp could not process this URL.",
            &diagnostics,
        )
    }
}

fn verify_output(path: &str, expected_container: &str, audio_required: bool) -> Result<(), String> {
    let output = Command::new(crate::video::tool("ffprobe"))
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=format_name:stream=codec_type",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .map_err(|error| format!("Could not verify downloaded output: {error}"))?;
    if !output.status.success() {
        return Err("FFprobe could not read the downloaded output.".into());
    }
    let report = String::from_utf8_lossy(&output.stdout).to_lowercase();
    let container_ok = match expected_container {
        "mp4" => report.contains("mp4") || report.contains("mov"),
        "webm" => report.contains("webm") || report.contains("matroska"),
        _ => true,
    };
    let has_video = report.lines().any(|line| line == "video");
    let has_audio = report.lines().any(|line| line == "audio");
    if !container_ok || !has_video || (audio_required && !has_audio) {
        return Err(format!(
            "Downloaded output did not match the requested {expected_container} video contract."
        ));
    }
    Ok(())
}

pub fn build_analyze_args(request: &AnalyzeRequest) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    append_provider_args(&mut args);
    append_auth_args(&mut args, request.auth_browser.as_deref())?;
    args.extend([
        "--verbose".into(),
        "--dump-single-json".into(),
        "--no-download".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
    ]);
    args.push(request.url.trim().into());
    Ok(args)
}

pub fn parse_metadata(json: &str) -> Result<DownloadMetadata, String> {
    let root: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Invalid downloader metadata: {e}"))?;
    let title = root["title"]
        .as_str()
        .unwrap_or("Untitled video")
        .to_string();
    let variants = root["formats"]
        .as_array()
        .map(|formats| {
            let mut result = Vec::new();
            let has_compatible_audio = |container: &str| {
                formats.iter().any(|audio| {
                    audio["vcodec"].as_str() == Some("none")
                        && audio["acodec"].as_str().is_some_and(|codec| codec != "none")
                        && match container {
                            "mp4" => matches!(audio["ext"].as_str(), Some("m4a" | "mp4")),
                            "webm" => audio["ext"].as_str() == Some("webm"),
                            _ => false,
                        }
                })
            };
            for item in formats {
                let id = item["format_id"].as_str().unwrap_or_default();
                let video_codec = item["vcodec"].as_str().filter(|v| *v != "none");
                if id.is_empty() || video_codec.is_none() {
                    continue;
                }
                let ext = item["ext"].as_str().unwrap_or("video");
                if !matches!(ext, "mp4" | "webm") || !has_compatible_audio(ext) {
                    continue;
                }
                let height = item["height"].as_u64();
                let width = item["width"].as_u64();
                let resolution = height
                    .map(|h| format!("{h}p"))
                    .or_else(|| item["format_note"].as_str().map(str::to_string));
                let audio_available = has_compatible_audio(ext);
                let size = item["filesize"]
                    .as_u64()
                    .or_else(|| item["filesize_approx"].as_u64());
                let label = match (resolution.as_deref(), width) {
                    (Some(res), _) => format!("{res} · {}", ext.to_uppercase()),
                    (None, Some(w)) => format!("{w}px · {}", ext.to_uppercase()),
                    _ => ext.to_uppercase(),
                };
                result.push(DownloadVariant {
                    format_id: id.to_string(),
                    label,
                    resolution,
                    container: Some(ext.to_string()),
                    video_codec: video_codec.map(str::to_string),
                    audio_available,
                    estimated_filesize: size,
                    height,
                });
            }
            result.sort_by(|a, b| {
                b.height
                    .cmp(&a.height)
                    .then_with(|| b.audio_available.cmp(&a.audio_available))
                    .then_with(|| a.container.cmp(&b.container))
                    .then_with(|| codec_rank(&a.video_codec).cmp(&codec_rank(&b.video_codec)))
                    .then_with(|| a.format_id.cmp(&b.format_id))
            });
            result.dedup_by(|a, b| {
                a.height == b.height && a.container == b.container
            });
            result
        })
        .unwrap_or_default();
    if variants.is_empty() {
        return Err(error_json(
            "Extractor failure",
            "No downloadable video formats were found.",
            "yt-dlp returned no video formats for this URL.",
        ));
    }
    Ok(DownloadMetadata {
        title,
        duration: root["duration"].as_f64(),
        thumbnail: root["thumbnail"].as_str().map(str::to_string),
        uploader: root["uploader"].as_str().map(str::to_string),
        source: root["extractor_key"].as_str().map(str::to_string),
        po_token_provider: None,
        variants,
    })
}

fn codec_rank(codec: &Option<String>) -> u8 {
    let codec = codec.as_deref().unwrap_or_default().to_lowercase();
    if codec.starts_with("avc1") || codec.starts_with("avc3") {
        0
    } else if codec.starts_with("av01") {
        1
    } else if codec.starts_with("vp09") || codec.starts_with("vp9") {
        2
    } else {
        3
    }
}

fn video_selector(height: u64, container: &str, codecs: &[&str]) -> String {
    let alternatives = codecs
        .iter()
        .map(|codec| format!("bestvideo[height={height}][ext={container}][vcodec^={codec}]"))
        .collect::<Vec<_>>()
        .join("/");
    format!("({alternatives})")
}

pub fn analyze(request: &AnalyzeRequest) -> Result<DownloadMetadata, String> {
    validate_url(&request.url)?;
    let args = build_analyze_args(request)?;
    let output = Command::new(crate::video::tool("yt-dlp"))
        .args(args)
        .output()
        .map_err(|e| {
            error_json(
                "yt-dlp unavailable",
                "yt-dlp is unavailable. Install it locally or set ND_YTDLP to its executable.",
                &e.to_string(),
            )
        })?;
    if !output.status.success() {
        return Err(structured_error(
            String::from_utf8_lossy(&output.stderr).trim(),
        ));
    }
    let mut metadata = parse_metadata(&String::from_utf8_lossy(&output.stdout))
        .map_err(|error| structured_error(&error))?;
    metadata.po_token_provider = detected_provider(&String::from_utf8_lossy(&output.stderr))
        .or_else(|| Some(provider_status()));
    Ok(metadata)
}

pub fn build_download_args(
    request: &DownloadRequest,
    output_template: &str,
) -> Result<Vec<String>, String> {
    let format_selector = if let Some(height) = request.max_height.filter(|height| *height > 0) {
        match request.container.as_deref() {
            Some("mp4") => format!(
                "{}+(bestaudio[ext=m4a]/bestaudio[ext=mp4])",
                video_selector(height, "mp4", &["avc1", "avc3", "av01", "vp09", "vp9"])
            ),
            Some("webm") => format!(
                "{}+bestaudio[ext=webm]",
                video_selector(height, "webm", &["vp09", "vp9", "av01"])
            ),
            _ => format!("bestvideo[height={height}]+bestaudio"),
        }
    } else if request.audio_available {
        request.format_id.clone()
    } else {
        format!("{}+bestaudio", request.format_id)
    };
    let mut args = vec![
        "--verbose".into(),
        "--no-playlist".into(),
        "--newline".into(),
        "--no-overwrites".into(),
        "--restrict-filenames".into(),
        "--format".into(),
        format_selector,
        "--output".into(),
        output_template.into(),
    ];
    if let Some(container) = request.container.as_deref().filter(|value| matches!(*value, "mp4" | "webm")) {
        args.extend(["--merge-output-format".into(), container.into()]);
    }
    append_provider_args(&mut args);
    append_auth_args(&mut args, request.auth_browser.as_deref())?;
    args.push(request.url.trim().into());
    Ok(args)
}

pub fn download(app: AppHandle, request: DownloadRequest) -> Result<String, String> {
    validate_url(&request.url)?;
    if request.format_id.trim().is_empty() {
        return Err("Please select a video quality".into());
    }
    let directory = request
        .output_directory
        .as_ref()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(std::path::PathBuf::from)
                .map(|home| home.join("Downloads"))
                .filter(|path| path.is_dir())
                .unwrap_or_else(|| {
                    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
                })
        });
    std::fs::create_dir_all(&directory).map_err(|e| format!("Cannot create output folder: {e}"))?;
    let template = directory
        .join("%(title)s.%(ext)s")
        .to_string_lossy()
        .to_string();
    let mut args = build_download_args(&request, &template)?;
    let url = args
        .pop()
        .expect("download command always includes the URL");
    args.extend([
        "--ffmpeg-location".into(),
        crate::video::tool("ffmpeg"),
        url,
    ]);
    let mut child = Command::new(crate::video::tool("yt-dlp"))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            error_json(
                "yt-dlp unavailable",
                "yt-dlp is unavailable. Install it locally or set ND_YTDLP to its executable.",
                &e.to_string(),
            )
        })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        error_json(
            "yt-dlp failure",
            "Could not read downloader diagnostics.",
            "The downloader process did not expose stderr.",
        )
    })?;
    let stderr_thread = thread::spawn(move || {
        let mut stderr = stderr;
        let mut detail = String::new();
        let _ = stderr.read_to_string(&mut detail);
        detail
    });
    let stdout = child.stdout.take().ok_or_else(|| {
        error_json(
            "yt-dlp failure",
            "Could not read downloader progress.",
            "The downloader process did not expose stdout.",
        )
    })?;
    let reader = BufReader::new(stdout);
    let mut output_path = None;
    for line in reader.lines().map_while(Result::ok) {
        if line.starts_with("[download]") {
            let percent = line
                .split_whitespace()
                .find_map(|part| part.strip_suffix('%').and_then(|v| v.parse().ok()));
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    status: "downloading".into(),
                    percent,
                    detail: Some(line.clone()),
                },
            );
        } else if let Some((_, path)) = line.split_once("Merging formats into ") {
            output_path = Some(path.trim_matches('"').trim().to_string());
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    status: "processing".into(),
                    percent: None,
                    detail: Some(line.clone()),
                },
            );
        } else if line.starts_with("[Merger]") || line.starts_with("[ExtractAudio]") {
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    status: "processing".into(),
                    percent: None,
                    detail: Some(line.clone()),
                },
            );
        }
        if line.contains("Destination:") {
            output_path = line
                .split_once("Destination:")
                .map(|(_, path)| path.trim().to_string());
        }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let detail = stderr_thread.join().unwrap_or_default();
    if !status.success() {
        return Err(structured_error(detail.trim()));
    }
    if let Some(container) = request.container.as_deref() {
        if let Some(path) = output_path.as_deref() {
            verify_output(path, container, request.audio_available)
                .map_err(|error| {
                    error_json("Output verification failed", &error, &sanitize_details(&detail))
                })?;
        }
    }
    let result = output_path.unwrap_or_else(|| directory.to_string_lossy().to_string());
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            status: "completed".into(),
            percent: Some(100.0),
            detail: Some(result.clone()),
        },
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_formats() {
        let metadata = parse_metadata(r#"{"title":"Demo","formats":[{"format_id":"18","ext":"mp4","width":1280,"height":720,"vcodec":"avc1","acodec":"mp4a","filesize":100},{"format_id":"136","ext":"mp4","height":720,"vcodec":"avc1","acodec":"none"},{"format_id":"247","ext":"webm","height":720,"vcodec":"vp9","acodec":"none"},{"format_id":"137","ext":"mp4","height":1080,"vcodec":"avc1","acodec":"none"},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a"},{"format_id":"251","ext":"webm","vcodec":"none","acodec":"opus"}]}"#).unwrap();
        assert_eq!(metadata.variants.len(), 3);
        let hd = metadata.variants.iter().find(|v| v.height == Some(720)).unwrap();
        assert!(hd.audio_available);
        assert_eq!(hd.label, "720p · MP4");
        assert!(!metadata.variants.iter().any(|v| v.label.contains("video only")));
        assert!(metadata.variants.iter().any(|v| v.label == "720p · WEBM"));
    }
    #[test]
    fn rejects_invalid_url() {
        let request = AnalyzeRequest {
            url: "not-a-url".into(),
            auth_browser: None,
        };
        assert!(analyze(&request).is_err());
    }
    #[test]
    fn builds_safe_download_command() {
        let request = DownloadRequest {
            url: "https://example.com/video".into(),
            format_id: "137".into(),
            audio_available: false,
            max_height: Some(1080),
            container: Some("mp4".into()),
            auth_browser: Some("chrome".into()),
            output_directory: None,
        };
        let args = build_download_args(&request, "/tmp/%(title)s.%(ext)s").unwrap();
        assert!(args.contains(&"--no-overwrites".into()));
        let selector = args.iter().find(|value| value.contains("[height=1080][ext=mp4]")).unwrap();
        assert!(selector.contains("[vcodec^=avc1]"));
        assert!(selector.contains("[vcodec^=av01]"));
        assert!(selector.contains("[vcodec^=vp09]"));
        assert!(selector.contains("bestaudio[ext=m4a]/bestaudio[ext=mp4]"));
        assert!(args.iter().any(|value| value == "mp4"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--cookies-from-browser", "chrome"]));
    }

    #[test]
    fn builds_container_specific_exact_height_selectors() {
        let base = DownloadRequest {
            url: "https://example.com/video".into(),
            format_id: "raw".into(),
            audio_available: true,
            max_height: Some(1080),
            container: Some("mp4".into()),
            auth_browser: None,
            output_directory: None,
        };
        let mp4_args = build_download_args(&base, "/tmp/%(title)s.%(ext)s").unwrap();
        assert!(mp4_args.iter().any(|value| value.contains("[height=1080][ext=mp4]")));
        assert!(mp4_args.iter().any(|value| value == "mp4"));

        let webm = DownloadRequest { container: Some("webm".into()), ..base };
        let webm_args = build_download_args(&webm, "/tmp/%(title)s.%(ext)s").unwrap();
        let webm_selector = webm_args.iter().find(|value| value.contains("[height=1080][ext=webm]")).unwrap();
        assert!(webm_selector.contains("[vcodec^=vp09]"));
        assert!(webm_selector.contains("[vcodec^=av01]"));
        assert!(webm_selector.ends_with("+bestaudio[ext=webm]"));
        assert!(webm_args.iter().any(|value| value == "webm"));
    }

    #[test]
    fn does_not_advertise_mp4_without_mp4_compatible_audio() {
        let result = parse_metadata(r#"{"title":"Demo","formats":[{"format_id":"248","ext":"mp4","height":1080,"vcodec":"vp9","acodec":"none"},{"format_id":"251","ext":"webm","vcodec":"none","acodec":"opus"}]}"#);
        assert!(result.is_err());
    }

    #[test]
    fn prefers_h264_then_av1_then_vp9_for_mp4_quality() {
        let result = parse_metadata(r#"{"title":"Demo","formats":[
            {"format_id":"vp9-1080","ext":"mp4","height":1080,"vcodec":"vp09.00.51.08","acodec":"none"},
            {"format_id":"av1-1080","ext":"mp4","height":1080,"vcodec":"av01.0.08M.08","acodec":"none"},
            {"format_id":"h264-1080","ext":"mp4","height":1080,"vcodec":"avc1.640028","acodec":"none"},
            {"format_id":"m4a","ext":"m4a","vcodec":"none","acodec":"mp4a"}
        ]}"#).unwrap();
        let variant = result.variants.iter().find(|v| v.label == "1080p · MP4").unwrap();
        assert!(variant.video_codec.as_deref().unwrap().starts_with("avc1"));
    }

    #[test]
    fn container_selectors_keep_exact_height_without_transcoding() {
        let request = DownloadRequest {
            url: "https://example.com/video".into(),
            format_id: "raw".into(),
            audio_available: true,
            max_height: Some(720),
            container: Some("mp4".into()),
            auth_browser: None,
            output_directory: None,
        };
        let args = build_download_args(&request, "/tmp/%(title)s.%(ext)s").unwrap();
        assert!(args.iter().any(|value| value.contains("[height=720]")));
        assert!(!args.iter().any(|value| value == "--recode-video"));
        assert!(!args.iter().any(|value| value.contains("transcode")));
    }

    #[test]
    fn rejects_arbitrary_browser_values() {
        let request = AnalyzeRequest {
            url: "https://example.com/video".into(),
            auth_browser: Some("--exec=bad".into()),
        };
        assert!(build_analyze_args(&request).is_err());
    }

    #[test]
    fn public_requests_do_not_add_cookie_flags() {
        let request = AnalyzeRequest {
            url: "https://example.com/video".into(),
            auth_browser: None,
        };
        let args = build_analyze_args(&request).unwrap();
        assert!(!args.iter().any(|value| value == "--cookies-from-browser"));
    }

    #[test]
    fn classifies_media_403_separately_from_network_errors() {
        let error: serde_json::Value = serde_json::from_str(&structured_error(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden",
        ))
        .unwrap();
        assert_eq!(error["kind"], "Media access denied");
        assert!(!error["kind"].as_str().unwrap().contains("Network"));
    }

    #[test]
    fn classifies_missing_po_token_provider() {
        let error: serde_json::Value = serde_json::from_str(&structured_error(
            "[youtube] [pot] PO Token Providers: none",
        ))
        .unwrap();
        assert_eq!(error["kind"], "PO Token provider unavailable");
    }

    #[test]
    fn reports_acquired_po_token_without_classifying_it_as_failure() {
        let detail = "[youtube] [pot:bgutil:cli] Retrieved a gvs PO Token for web client";
        assert_eq!(provider_flow(detail), "detected -> invoked -> acquired");
        assert!(!structured_error(detail).contains("PO Token acquisition failed"));
    }

    #[test]
    fn classifies_youtube_reload_separately_from_po_token_failure() {
        let error: serde_json::Value = serde_json::from_str(&structured_error(
            "[youtube] The page needs to be reloaded.",
        ))
        .unwrap();
        assert_eq!(error["kind"], "YouTube session refresh required");
    }

    #[test]
    fn classifies_media_403_after_token_acquisition_as_media_access_denied() {
        let error: serde_json::Value = serde_json::from_str(&structured_error(
            "[youtube] Retrieved a gvs PO Token for web_safari client\nERROR: unable to download video data: HTTP Error 403: Forbidden",
        ))
        .unwrap();
        assert_eq!(error["kind"], "Media access denied");
        assert!(error["details"].as_str().unwrap().contains("acquired"));
    }

    #[test]
    fn sanitizes_sensitive_media_details() {
        let sanitized = sanitize_details(
            "https://rr.googlevideo.com/videoplayback?sig=secret\nAuthorization: Bearer secret\nPO Token: secret\n[youtube] SABR request failed",
        );
        assert!(!sanitized.contains("googlevideo"));
        assert!(!sanitized.contains("secret"));
        assert!(sanitized.contains("SABR request failed"));
    }
}
