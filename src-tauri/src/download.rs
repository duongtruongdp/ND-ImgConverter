use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader, Read};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static DOWNLOAD_CANCELLED: OnceLock<AtomicBool> = OnceLock::new();
static ACTIVE_JOB_ID: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn cancel_flag() -> &'static AtomicBool {
    DOWNLOAD_CANCELLED.get_or_init(|| AtomicBool::new(false))
}

fn active_job_id() -> &'static Mutex<Option<String>> {
    ACTIVE_JOB_ID.get_or_init(|| Mutex::new(None))
}

pub fn begin(job_id: &str) {
    cancel_flag().store(false, Ordering::SeqCst);
    if let Ok(mut active) = active_job_id().lock() {
        *active = Some(job_id.to_string());
    }
}

pub fn reset_for_analysis() {
    cancel_flag().store(false, Ordering::SeqCst);
    if let Ok(mut active) = active_job_id().lock() {
        *active = None;
    }
}

pub fn finish(job_id: &str) {
    if let Ok(mut active) = active_job_id().lock() {
        if active.as_deref() == Some(job_id) {
            *active = None;
            cancel_flag().store(false, Ordering::SeqCst);
        }
    }
}

pub fn cancel(job_id: &str) {
    let matches_active = active_job_id()
        .lock()
        .ok()
        .and_then(|active| active.as_deref().map(|value| value == job_id))
        .unwrap_or(false);
    if matches_active {
        cancel_flag().store(true, Ordering::SeqCst);
    }
}

fn cancelled_error() -> String {
    error_json("Download cancelled", "Download cancelled.", "The active media process was stopped by the user.")
}

#[cfg(unix)]
use std::os::unix::process::CommandExt;

fn spawn_media_command(mut command: Command) -> io::Result<Child> {
    #[cfg(unix)]
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
    command.spawn()
}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        unsafe {
            let _ = libc::kill(process_group, libc::SIGTERM);
        }
        thread::sleep(Duration::from_millis(50));
        if child.try_wait().ok().flatten().is_none() {
            unsafe {
                let _ = libc::kill(process_group, libc::SIGKILL);
            }
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn run_cancelable_output(command: Command) -> Result<Output, String> {
    let mut child = spawn_media_command(command).map_err(|error| error.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "The process did not expose stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "The process did not expose stderr.".to_string())?;
    let stdout_thread = thread::spawn(move || {
        let mut output = Vec::new();
        let _ = BufReader::new(stdout).read_to_end(&mut output);
        output
    });
    let stderr_thread = thread::spawn(move || {
        let mut output = Vec::new();
        let _ = BufReader::new(stderr).read_to_end(&mut output);
        output
    });
    loop {
        if cancel_flag().load(Ordering::SeqCst) {
            terminate_process_tree(&mut child);
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            return Err(cancelled_error());
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            let stdout = stdout_thread.join().unwrap_or_default();
            let stderr = stderr_thread.join().unwrap_or_default();
            return Ok(Output { status, stdout, stderr });
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[derive(Debug)]
enum ProcessLine {
    Stdout(String),
    Stderr(String),
}

fn stream_process_lines(child: &mut Child) -> io::Result<mpsc::Receiver<ProcessLine>> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("The process did not expose stdout."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("The process did not expose stderr."))?;
    let (sender, receiver) = mpsc::channel();
    let stdout_sender = sender.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = stdout_sender.send(ProcessLine::Stdout(line));
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = sender.send(ProcessLine::Stderr(line));
        }
    });
    Ok(receiver)
}

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
    pub audio_only: bool,
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
    pub media_kind: String,
    pub collection_count: Option<u64>,
    pub items: Vec<PlaylistItem>,
    pub variants: Vec<DownloadVariant>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub index: u64,
    pub id: String,
    pub title: String,
    pub url: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub estimated_filesize: Option<u64>,
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
    pub playlist: bool,
    pub playlist_items: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    pub url: String,
    pub auth_browser: Option<String>,
    pub include_playlist: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryDownloadRequest {
    pub url: String,
    pub auth_browser: Option<String>,
    pub output_directory: Option<String>,
    pub selected_indices: Option<Vec<u64>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryAnalyzeRequest {
    pub url: String,
    pub auth_browser: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GalleryItem {
    pub index: u64,
    pub title: String,
    pub url: String,
    pub extension: Option<String>,
    pub estimated_filesize: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryMetadata {
    pub title: String,
    pub items: Vec<GalleryItem>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub status: String,
    pub percent: Option<f64>,
    pub detail: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub completed_items: Option<u64>,
    pub total_items: Option<u64>,
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
        .or_else(|| crate::runtime::resolve_optional_path(crate::runtime::BinaryKind::BgutilPot))
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
    let path = crate::runtime::resolve_path(crate::runtime::BinaryKind::YtDlp)
        .unwrap_or_else(|error| format!("<unavailable: {error}>"));
    format!(
        "yt-dlp path: {}\nyt-dlp source: {}\nyt-dlp version: {} ({})\nplugin root: {}\nbgutil-pot path: {}\nPO Token provider: {}",
        path,
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
    let parsed = reqwest::Url::parse(trimmed).ok();
    let valid_scheme = parsed
        .as_ref()
        .is_some_and(|value| matches!(value.scheme(), "http" | "https"));
    let host = parsed.as_ref().and_then(reqwest::Url::host_str);
    if !valid_scheme || host.is_none() || trimmed.len() <= 8 {
        return Err(error_json(
            "Invalid URL",
            "Please enter a valid http(s) media URL",
            "The URL must use http:// or https:// and include a hostname.",
        ));
    }
    let host = host.unwrap_or_default().trim_end_matches('.').to_ascii_lowercase();
    let local_host = matches!(host.as_str(), "localhost" | "localhost.localdomain")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.parse::<std::net::IpAddr>().is_ok_and(|address| {
            address.is_loopback()
                || address.is_unspecified()
                || match address {
                    std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
                    std::net::IpAddr::V6(ip) => ip.is_unique_local() || ip.is_unicast_link_local(),
                }
        });
    if local_host {
        return Err(error_json(
            "URL blocked",
            "Local and private network URLs are not allowed.",
            "Media URLs must point to a public HTTP(S) host.",
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
            "Choose a browser from the sign-in options.",
        )),
    }
}

fn append_auth_args(args: &mut Vec<String>, browser: Option<&str>) -> Result<(), String> {
    if let Some(browser) = validate_browser(browser)? {
        args.extend(["--cookies-from-browser".into(), browser.into()]);
    }
    Ok(())
}

fn parse_progress_number(value: &str) -> Option<u64> {
    value.trim().parse::<u64>().ok()
}

fn parse_progress_percent(value: &str) -> Option<f64> {
    value
        .trim()
        .trim_end_matches('%')
        .parse::<f64>()
        .ok()
}

fn emit_video_progress(app: &AppHandle, line: &str) -> bool {
    let Some(payload) = line.strip_prefix("ND_PROGRESS ") else {
        return false;
    };
    let parts = payload.split('|').collect::<Vec<_>>();
    let percent = parts.get(1).and_then(|value| parse_progress_percent(value));
    let downloaded_bytes = parts.get(2).and_then(|value| parse_progress_number(value));
    let total_bytes = parts
        .get(3)
        .and_then(|value| parse_progress_number(value))
        .or_else(|| parts.get(4).and_then(|value| parse_progress_number(value)));
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            status: if parts.first() == Some(&"finished") {
                "processing".into()
            } else {
                "downloading".into()
            },
            percent,
            detail: Some("Downloading media…".into()),
            downloaded_bytes,
            total_bytes,
            completed_items: None,
            total_items: None,
        },
    );
    true
}

fn gallery_line_progress(line: &str, completed: u64) -> Option<u64> {
    let trimmed = line.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(trimmed.starts_with("# ")
        || lower.starts_with("downloaded ")
        || lower.contains("saved to")
        || lower.contains("written to"))
    {
        return None;
    }
    Some(completed.saturating_add(1))
}

fn yt_dlp_version() -> String {
    let Ok(path) = crate::video::tool("yt-dlp") else {
        return "unavailable".into();
    };
    Command::new(path)
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
    } else if cfg!(debug_assertions)
        || std::env::var("ND_ALLOW_SYSTEM_BINARIES")
            .map(|value| {
                matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes"
                )
            })
            .unwrap_or(false)
    {
        "system fallback"
    } else {
        "unavailable"
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
        sanitize_details(detail)
            .chars()
            .take(8000)
            .collect::<String>()
    );
    if lower.contains("sign in to confirm")
        || lower.contains("not a bot")
        || lower.contains("requires authentication")
    {
        error_json(
            "Sign-in required",
            "This site asks you to sign in. Select a browser with an active signed-in session, then try again.",
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
    } else if lower.contains("private video")
        || lower.contains("video has been removed")
        || lower.contains("video unavailable")
        || lower.contains("media is unavailable")
    {
        error_json(
            "Media unavailable",
            "This video is private, removed, or no longer available.",
            &diagnostics,
        )
    } else if lower.contains("not available in your country")
        || lower.contains("geo-restricted")
        || lower.contains("georestricted")
    {
        error_json(
            "Region restricted",
            "This video is not available in the current region.",
            &diagnostics,
        )
    } else if lower.contains("no downloadable video formats")
        || lower.contains("no video formats found")
    {
        error_json(
            "No downloadable formats",
            "No compatible video output was found for this URL.",
            &diagnostics,
        )
    } else if lower.contains("ffmpeg")
        || lower.contains("merging formats")
        || lower.contains("postprocessing")
    {
        error_json(
            "FFmpeg/mux failure",
            "The video was downloaded, but the final output could not be assembled.",
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
    let ffprobe = crate::video::tool("ffprobe")?;
    let output = Command::new(ffprobe)
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
        "--no-warnings".into(),
    ]);
    if request.include_playlist {
        args.extend(["--flat-playlist".into(), "--playlist-end".into(), "200".into()]);
    } else {
        args.push("--no-playlist".into());
    }
    args.push(request.url.trim().into());
    Ok(args)
}

pub fn parse_metadata(json: &str) -> Result<DownloadMetadata, String> {
    let root: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Invalid downloader metadata: {e}"))?;
    let media_kind = if root["_type"].as_str() == Some("playlist") {
        "playlist"
    } else {
        "video"
    };
    let collection_count = root["playlist_count"]
        .as_u64()
        .or_else(|| root["n_entries"].as_u64());
    let title = root["title"]
        .as_str()
        .unwrap_or(if media_kind == "playlist" {
            "Untitled playlist"
        } else {
            "Untitled media"
        })
        .to_string();
    let mut variants = root["formats"]
        .as_array()
        .map(|formats| {
            let mut result = Vec::new();
            let has_compatible_audio = |container: &str| {
                formats.iter().any(|audio| {
                    audio["vcodec"].as_str() == Some("none")
                        && audio["acodec"]
                            .as_str()
                            .is_some_and(|codec| codec != "none")
                        && match container {
                            "mp4" => matches!(audio["ext"].as_str(), Some("m4a" | "mp4")),
                            "webm" => audio["ext"].as_str() == Some("webm"),
                            _ => false,
                        }
                })
            };
            let has_audio = formats.iter().any(|audio| {
                audio["vcodec"].as_str() == Some("none")
                    && audio["acodec"]
                        .as_str()
                        .is_some_and(|codec| codec != "none")
            });
            for item in formats {
                let id = item["format_id"].as_str().unwrap_or_default();
                let raw_video_codec = item["vcodec"].as_str();
                let video_codec = raw_video_codec.filter(|v| *v != "none");
                let is_progressive = raw_video_codec.is_none()
                    && item["acodec"].as_str().is_none()
                    && item["url"].as_str().is_some();
                if id.is_empty() || (video_codec.is_none() && !is_progressive) {
                    continue;
                }
                let ext = item["ext"].as_str().unwrap_or("video");
                if !matches!(ext, "mp4" | "webm") || (!is_progressive && !has_compatible_audio(ext))
                {
                    continue;
                }
                let height = item["height"].as_u64();
                let width = item["width"].as_u64();
                let resolution = height
                    .map(|h| format!("{h}p"))
                    .or_else(|| item["format_note"].as_str().map(str::to_string));
                let audio_available = is_progressive || has_compatible_audio(ext);
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
                    audio_only: false,
                });
            }
            if has_audio {
                result.push(DownloadVariant {
                    format_id: "audio-only".into(),
                    label: "Audio only".into(),
                    resolution: None,
                    container: None,
                    video_codec: None,
                    audio_available: true,
                    estimated_filesize: None,
                    height: None,
                    audio_only: true,
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
            result.dedup_by(|a, b| a.height == b.height && a.container == b.container);
            result
        })
        .unwrap_or_default();
    if media_kind == "playlist" && variants.is_empty() {
        variants.push(DownloadVariant {
            format_id: "best".into(),
            label: "Best Available".into(),
            resolution: None,
            container: None,
            video_codec: None,
            audio_available: true,
            estimated_filesize: None,
            height: None,
            audio_only: false,
        });
    }
    if variants.is_empty() {
        return Err(error_json(
            "Extractor failure",
            "No downloadable video formats were found.",
            "yt-dlp returned no video formats for this URL.",
        ));
    }
    let items = if media_kind == "playlist" {
        root["entries"]
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .enumerate()
                    .filter_map(|(index, entry)| {
                        let url = entry["webpage_url"]
                            .as_str()
                            .or_else(|| entry["url"].as_str())
                            .map(str::to_string);
                        let id = entry["id"]
                            .as_str()
                            .or_else(|| url.as_deref())
                            .unwrap_or_default();
                        if id.is_empty() {
                            return None;
                        }
                        Some(PlaylistItem {
                            index: index as u64 + 1,
                            id: id.to_string(),
                            title: entry["title"]
                                .as_str()
                                .unwrap_or("Untitled media")
                                .to_string(),
                            url,
                            duration: entry["duration"].as_f64(),
                            thumbnail: entry["thumbnail"].as_str().map(str::to_string),
                            estimated_filesize: entry["filesize"]
                                .as_u64()
                                .or_else(|| entry["filesize_approx"].as_u64()),
                        })
                    })
                    .take(200)
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(DownloadMetadata {
        title,
        duration: root["duration"].as_f64(),
        thumbnail: root["thumbnail"].as_str().map(str::to_string),
        uploader: root["uploader"].as_str().map(str::to_string),
        source: root["extractor_key"].as_str().map(str::to_string),
        po_token_provider: None,
        media_kind: media_kind.into(),
        collection_count,
        items,
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
    let ytdlp = crate::video::tool("yt-dlp").map_err(|error| {
        error_json(
            "yt-dlp unavailable",
            "The media downloader is unavailable. Use a packaged build or enable an explicit development binary.",
            &error,
        )
    })?;
    let output = run_cancelable_output({
        let mut command = Command::new(ytdlp);
        command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        command
    })
    .map_err(|error| {
        if error == cancelled_error() {
            error
        } else {
            error_json(
                "yt-dlp unavailable",
                "yt-dlp is unavailable. Install it locally or set ND_YTDLP to its executable.",
                &error,
            )
        }
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
    let format_selector = if request.format_id == "audio-only" {
        "bestaudio/best".into()
    } else if request.format_id == "best" && request.max_height.is_none() {
        "bestvideo*+bestaudio/best".into()
    } else if let Some(height) = request.max_height.filter(|height| *height > 0) {
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
        "--newline".into(),
        "--no-overwrites".into(),
        "--restrict-filenames".into(),
        "--format".into(),
        format_selector,
        "--output".into(),
        output_template.into(),
        "--progress-template".into(),
        "download:ND_PROGRESS %(progress.status)s|%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s".into(),
    ];
    if !request.playlist {
        args.push("--no-playlist".into());
    } else if let Some(items) = request
        .playlist_items
        .as_deref()
        .map(str::trim)
        .filter(|items| !items.is_empty())
    {
        args.extend(["--playlist-items".into(), items.into()]);
    }
    if request.format_id == "audio-only" {
        args.extend(["--extract-audio".into(), "--audio-format".into(), "best".into()]);
    }
    if let Some(container) = request
        .container
        .as_deref()
        .filter(|value| matches!(*value, "mp4" | "webm"))
    {
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
    let template_name = if request.playlist {
        "%(playlist_title)s/%(playlist_index)s - %(title)s.%(ext)s"
    } else {
        "%(title)s.%(ext)s"
    };
    let template = directory
        .join(template_name)
        .to_string_lossy()
        .to_string();
    let mut args = build_download_args(&request, &template)?;
    let url = args
        .pop()
        .expect("download command always includes the URL");
    let ffmpeg = crate::video::tool("ffmpeg").map_err(|error| {
        error_json(
            "FFmpeg unavailable",
            "The media engine is unavailable. Some downloads require FFmpeg to assemble the final file.",
            &error,
        )
    })?;
    let ytdlp = crate::video::tool("yt-dlp").map_err(|error| {
        error_json(
            "yt-dlp unavailable",
            "The media downloader is unavailable. Use a packaged build or enable an explicit development binary.",
            &error,
        )
    })?;
    args.extend(["--ffmpeg-location".into(), ffmpeg, url]);
    let mut command = Command::new(ytdlp);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = spawn_media_command(command)
        .map_err(|e| {
            error_json(
                "yt-dlp unavailable",
                "yt-dlp is unavailable. Install it locally or set ND_YTDLP to its executable.",
                &e.to_string(),
            )
        })?;
    let receiver = stream_process_lines(&mut child).map_err(|error| {
        error_json(
            "yt-dlp failure",
            "Could not read downloader progress.",
            &error.to_string(),
        )
    })?;
    let mut output_path = None;
    let mut detail = String::new();
    let mut status = None;
    let mut channel_closed = false;
    while !channel_closed || status.is_none() {
        if cancel_flag().load(Ordering::SeqCst) {
            terminate_process_tree(&mut child);
            return Err(cancelled_error());
        }
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(ProcessLine::Stdout(line)) => {
                if emit_video_progress(&app, &line) {
                    continue;
                }
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
                            downloaded_bytes: None,
                            total_bytes: None,
                            completed_items: None,
                            total_items: None,
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
                            downloaded_bytes: None,
                            total_bytes: None,
                            completed_items: None,
                            total_items: None,
                        },
                    );
                } else if line.starts_with("[Merger]") || line.starts_with("[ExtractAudio]") {
                    let _ = app.emit(
                        "download-progress",
                        DownloadProgress {
                            status: "processing".into(),
                            percent: None,
                            detail: Some(line.clone()),
                            downloaded_bytes: None,
                            total_bytes: None,
                            completed_items: None,
                            total_items: None,
                        },
                    );
                }
                if line.contains("Destination:") {
                    output_path = line
                        .split_once("Destination:")
                        .map(|(_, path)| path.trim().to_string());
                }
            }
            Ok(ProcessLine::Stderr(line)) => {
                detail.push_str(&line);
                detail.push('\n');
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => channel_closed = true,
        }
        if status.is_none() {
            status = child.try_wait().map_err(|e| e.to_string())?;
        }
    }
    let status = status.unwrap_or_else(|| child.wait().expect("yt-dlp process status available"));
    if cancel_flag().load(Ordering::SeqCst) {
        return Err(cancelled_error());
    }
    if !status.success() {
        return Err(structured_error(detail.trim()));
    }
    if let Some(container) = request.container.as_deref() {
        if let Some(path) = output_path.as_deref() {
            verify_output(path, container, request.audio_available).map_err(|error| {
                error_json(
                    "Output verification failed",
                    &error,
                    &sanitize_details(&detail),
                )
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
            downloaded_bytes: None,
            total_bytes: None,
            completed_items: None,
            total_items: None,
        },
    );
    Ok(result)
}

fn gallery_error(detail: &str) -> String {
    let lower = detail.to_lowercase();
    let kind = if lower.contains("unsupported") || lower.contains("no extractor") {
        "Unsupported image/gallery URL"
    } else if lower.contains("login") || lower.contains("authentication") {
        "Sign-in required"
    } else if lower.contains("403") || lower.contains("forbidden") {
        "Media access denied"
    } else if lower.contains("timed out") || lower.contains("connection") {
        "Network failure"
    } else {
        "gallery-dl failure"
    };
    error_json(
        kind,
        match kind {
            "Unsupported image/gallery URL" => "This image or gallery is not supported by gallery-dl.",
            "Sign-in required" => "This image source asks you to sign in. Choose a browser session and try again.",
            "Media access denied" => "The image source refused access to this gallery.",
            "Network failure" => "The image gallery could not be reached. Check your connection and try again.",
            _ => "gallery-dl could not download this image or gallery.",
        },
        &sanitize_details(detail),
    )
}

pub fn build_gallery_download_args(
    request: &GalleryDownloadRequest,
    output_directory: &str,
) -> Result<Vec<String>, String> {
    validate_url(&request.url)?;
    let mut args = vec![
        "--no-input".into(),
        "--destination".into(),
        output_directory.into(),
    ];
    if let Some(indices) = request.selected_indices.as_ref().filter(|items| !items.is_empty()) {
        let expression = indices
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        args.extend(["--range".into(), expression]);
    }
    append_auth_args(&mut args, request.auth_browser.as_deref())?;
    args.push(request.url.trim().into());
    Ok(args)
}

pub fn build_gallery_analyze_args(request: &GalleryAnalyzeRequest) -> Result<Vec<String>, String> {
    validate_url(&request.url)?;
    let mut args = vec![
        "--dump-json".into(),
        "--simulate".into(),
        "--no-input".into(),
        "--range".into(),
        "1-200".into(),
    ];
    append_auth_args(&mut args, request.auth_browser.as_deref())?;
    args.push(request.url.trim().into());
    Ok(args)
}

pub fn parse_gallery_metadata(json: &str) -> Result<GalleryMetadata, String> {
    let root: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| format!("Invalid gallery metadata: {error}"))?;
    let records = root
        .as_array()
        .ok_or_else(|| "gallery-dl returned no metadata records".to_string())?;
    let mut title = "Image gallery".to_string();
    let mut items = Vec::new();
    for record in records {
        let Some(parts) = record.as_array() else { continue };
        let Some(kind) = parts.first().and_then(serde_json::Value::as_u64) else { continue };
        if kind == 2 {
            let Some(metadata) = parts
                .get(1)
                .and_then(serde_json::Value::as_object)
            else {
                continue;
            };
            if let Some(value) = metadata.get("title").and_then(serde_json::Value::as_str) {
                title = value.to_string();
            }
            continue;
        }
        if kind != 3 { continue; }
        let Some(metadata) = parts.get(2).and_then(serde_json::Value::as_object) else { continue };
        let Some(url) = parts.get(1).and_then(serde_json::Value::as_str) else { continue };
        let index = metadata
            .get("num")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(items.len() as u64 + 1);
        items.push(GalleryItem {
            index,
            title: metadata
                .get("filename")
                .and_then(serde_json::Value::as_str)
                .or_else(|| metadata.get("title").and_then(serde_json::Value::as_str))
                .unwrap_or("Image")
                .to_string(),
            url: url.to_string(),
            extension: metadata
                .get("extension")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            estimated_filesize: metadata
                .get("filesize")
                .and_then(serde_json::Value::as_u64),
        });
    }
    if items.is_empty() {
        return Err("gallery-dl returned no downloadable images".into());
    }
    Ok(GalleryMetadata { title, items })
}

pub fn analyze_gallery(request: &GalleryAnalyzeRequest) -> Result<GalleryMetadata, String> {
    let gallery = crate::video::tool("gallery-dl").map_err(|error| {
        error_json(
            "Gallery engine unavailable",
            "Image downloads aren't ready yet.",
            &error,
        )
    })?;
    let args = build_gallery_analyze_args(request)?;
    let output = run_cancelable_output({
        let mut command = Command::new(gallery);
        command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        command
    })
    .map_err(|error| {
        if error == cancelled_error() {
            error
        } else {
            error_json(
                "Gallery engine unavailable",
                "gallery-dl could not be started.",
                &error,
            )
        }
    })?;
    if !output.status.success() {
        return Err(gallery_error(&String::from_utf8_lossy(&output.stderr)));
    }
    parse_gallery_metadata(&String::from_utf8_lossy(&output.stdout))
        .map_err(|error| gallery_error(&error))
}

pub fn download_gallery(app: AppHandle, request: GalleryDownloadRequest) -> Result<String, String> {
    validate_url(&request.url)?;
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
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create image output folder: {error}"))?;
    let gallery = crate::video::tool("gallery-dl").map_err(|error| {
        error_json(
            "Gallery engine unavailable",
            "Image and gallery downloads are not included in this build yet.",
            &error,
        )
    })?;
    let output_directory = directory.to_string_lossy().to_string();
    let args = build_gallery_download_args(&request, &output_directory)?;
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            status: "downloading".into(),
            percent: None,
            detail: Some("Downloading images…".into()),
            downloaded_bytes: None,
            total_bytes: None,
            completed_items: Some(0),
            total_items: request.selected_indices.as_ref().map(|items| items.len() as u64),
        },
    );
    let mut command = Command::new(gallery);
    command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = spawn_media_command(command)
        .map_err(|error| error_json("Gallery engine unavailable", "gallery-dl could not be started.", &error.to_string()))?;
    let receiver = stream_process_lines(&mut child)
        .map_err(|error| error_json("gallery-dl failure", "Could not read gallery progress.", &error.to_string()))?;
    let total_items = request.selected_indices.as_ref().map(|items| items.len() as u64);
    let mut completed_items = 0_u64;
    let mut detail = String::new();
    let mut status = None;
    let mut channel_closed = false;
    while !channel_closed || status.is_none() {
        if cancel_flag().load(Ordering::SeqCst) {
            terminate_process_tree(&mut child);
            return Err(cancelled_error());
        }
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(ProcessLine::Stdout(line)) | Ok(ProcessLine::Stderr(line)) => {
                if let Some(next) = gallery_line_progress(&line, completed_items) {
                    completed_items = next.min(total_items.unwrap_or(u64::MAX));
                    let _ = app.emit(
                        "download-progress",
                        DownloadProgress {
                            status: "downloading".into(),
                            percent: total_items.filter(|total| *total > 0).map(|total| completed_items as f64 * 100.0 / total as f64),
                            detail: Some(line.clone()),
                            downloaded_bytes: None,
                            total_bytes: None,
                            completed_items: Some(completed_items),
                            total_items,
                        },
                    );
                }
                if !line.is_empty() {
                    detail.push_str(&line);
                    detail.push('\n');
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => channel_closed = true,
        }
        if status.is_none() {
            status = child.try_wait().map_err(|error| error.to_string())?;
        }
    }
    let status = status.unwrap_or_else(|| child.wait().expect("gallery process status available"));
    if !status.success() {
        return Err(gallery_error(&detail));
    }
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            status: "completed".into(),
            percent: Some(100.0),
            detail: Some(output_directory.clone()),
            downloaded_bytes: None,
            total_bytes: None,
            completed_items: total_items.or(Some(completed_items)),
            total_items,
        },
    );
    Ok(output_directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_formats() {
        let metadata = parse_metadata(r#"{"title":"Demo","formats":[{"format_id":"18","ext":"mp4","width":1280,"height":720,"vcodec":"avc1","acodec":"mp4a","filesize":100},{"format_id":"136","ext":"mp4","height":720,"vcodec":"avc1","acodec":"none"},{"format_id":"247","ext":"webm","height":720,"vcodec":"vp9","acodec":"none"},{"format_id":"137","ext":"mp4","height":1080,"vcodec":"avc1","acodec":"none"},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a"},{"format_id":"251","ext":"webm","vcodec":"none","acodec":"opus"}]}"#).unwrap();
        assert_eq!(metadata.variants.len(), 4);
        let hd = metadata
            .variants
            .iter()
            .find(|v| v.height == Some(720))
            .unwrap();
        assert!(hd.audio_available);
        assert_eq!(hd.label, "720p · MP4");
        assert!(!metadata
            .variants
            .iter()
            .any(|v| v.label.contains("video only")));
        assert!(metadata.variants.iter().any(|v| v.label == "720p · WEBM"));
        assert!(metadata.variants.iter().any(|v| v.audio_only));
    }
    #[test]
    fn rejects_invalid_url() {
        let request = AnalyzeRequest {
            url: "not-a-url".into(),
            auth_browser: None,
            include_playlist: false,
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
            playlist: false,
            playlist_items: None,
        };
        let args = build_download_args(&request, "/tmp/%(title)s.%(ext)s").unwrap();
        assert!(args.contains(&"--no-overwrites".into()));
        let selector = args
            .iter()
            .find(|value| value.contains("[height=1080][ext=mp4]"))
            .unwrap();
        assert!(selector.contains("[vcodec^=avc1]"));
        assert!(selector.contains("[vcodec^=av01]"));
        assert!(selector.contains("[vcodec^=vp09]"));
        assert!(selector.contains("bestaudio[ext=m4a]/bestaudio[ext=mp4]"));
        assert!(args.iter().any(|value| value == "mp4"));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--cookies-from-browser", "chrome"]));
        assert!(args.iter().any(|value| value.starts_with("download:ND_PROGRESS ")));
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
            playlist: false,
            playlist_items: None,
        };
        let mp4_args = build_download_args(&base, "/tmp/%(title)s.%(ext)s").unwrap();
        assert!(mp4_args
            .iter()
            .any(|value| value.contains("[height=1080][ext=mp4]")));
        assert!(mp4_args.iter().any(|value| value == "mp4"));

        let webm = DownloadRequest {
            container: Some("webm".into()),
            ..base
        };
        let webm_args = build_download_args(&webm, "/tmp/%(title)s.%(ext)s").unwrap();
        let webm_selector = webm_args
            .iter()
            .find(|value| value.contains("[height=1080][ext=webm]"))
            .unwrap();
        assert!(webm_selector.contains("[vcodec^=vp09]"));
        assert!(webm_selector.contains("[vcodec^=av01]"));
        assert!(webm_selector.ends_with("+bestaudio[ext=webm]"));
        assert!(webm_args.iter().any(|value| value == "webm"));
    }

    #[test]
    fn does_not_advertise_mp4_without_mp4_compatible_audio() {
        let result = parse_metadata(
            r#"{"title":"Demo","formats":[{"format_id":"248","ext":"mp4","height":1080,"vcodec":"vp9","acodec":"none"},{"format_id":"251","ext":"webm","vcodec":"none","acodec":"opus"}]}"#,
        );
        let metadata = result.unwrap();
        assert_eq!(metadata.variants.len(), 1);
        assert!(metadata.variants[0].audio_only);
    }

    #[test]
    fn prefers_h264_then_av1_then_vp9_for_mp4_quality() {
        let result = parse_metadata(r#"{"title":"Demo","formats":[
            {"format_id":"vp9-1080","ext":"mp4","height":1080,"vcodec":"vp09.00.51.08","acodec":"none"},
            {"format_id":"av1-1080","ext":"mp4","height":1080,"vcodec":"av01.0.08M.08","acodec":"none"},
            {"format_id":"h264-1080","ext":"mp4","height":1080,"vcodec":"avc1.640028","acodec":"none"},
            {"format_id":"m4a","ext":"m4a","vcodec":"none","acodec":"mp4a"}
        ]}"#).unwrap();
        let variant = result
            .variants
            .iter()
            .find(|v| v.label == "1080p · MP4")
            .unwrap();
        assert!(variant.video_codec.as_deref().unwrap().starts_with("avc1"));
    }

    #[test]
    fn keeps_progressive_av_video_without_codec_metadata() {
        let metadata = parse_metadata(
            r#"{"title":"Facebook clip","formats":[
            {"format_id":"sd","ext":"mp4","url":"https://cdn.example/sd.mp4"},
            {"format_id":"hd","ext":"mp4","url":"https://cdn.example/hd.mp4"}
        ]}"#,
        )
        .unwrap();
        assert_eq!(metadata.variants.len(), 1);
        assert_eq!(metadata.variants[0].label, "MP4");
        assert!(metadata.variants[0].audio_available);
        assert_eq!(metadata.variants[0].height, None);
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
            playlist: false,
            playlist_items: None,
        };
        let args = build_download_args(&request, "/tmp/%(title)s.%(ext)s").unwrap();
        assert!(args.iter().any(|value| value.contains("[height=720]")));
        assert!(!args.iter().any(|value| value == "--recode-video"));
        assert!(!args.iter().any(|value| value.contains("transcode")));
    }

    #[test]
    fn best_available_uses_real_best_video_and_audio_selector() {
        let request = DownloadRequest {
            url: "https://example.com/video".into(),
            format_id: "best".into(),
            audio_available: true,
            max_height: None,
            container: None,
            auth_browser: None,
            output_directory: None,
            playlist: false,
            playlist_items: None,
        };
        let args = build_download_args(&request, "/tmp/%(title)s.%(ext)s").unwrap();
        assert!(args.iter().any(|value| value == "bestvideo*+bestaudio/best"));
        assert!(args.iter().any(|value| value == "--no-playlist"));
    }

    #[test]
    fn playlist_download_requires_explicit_playlist_flag() {
        let request = DownloadRequest {
            url: "https://example.com/playlist".into(),
            format_id: "best".into(),
            audio_available: true,
            max_height: None,
            container: None,
            auth_browser: None,
            output_directory: None,
            playlist: true,
            playlist_items: Some("1,3-4".into()),
        };
        let args = build_download_args(&request, "/tmp/%(playlist_index)s-%(title)s.%(ext)s").unwrap();
        assert!(!args.iter().any(|value| value == "--no-playlist"));
        assert!(args.windows(2).any(|pair| pair == ["--playlist-items", "1,3-4"]));
    }

    #[test]
    fn blocks_local_and_private_url_targets() {
        for url in ["http://127.0.0.1/video", "http://localhost/video", "http://10.0.0.4/video"] {
            assert!(validate_url(url).is_err(), "expected blocked URL: {url}");
        }
        assert!(validate_url("https://example.com/video").is_ok());
    }

    #[test]
    fn gallery_route_uses_central_auth_and_destination_arguments() {
        let request = GalleryDownloadRequest {
            url: "https://example.com/gallery".into(),
            auth_browser: Some("firefox".into()),
            output_directory: None,
            selected_indices: Some(vec![1, 3]),
        };
        let args = build_gallery_download_args(&request, "/tmp/images").unwrap();
        assert!(args.windows(2).any(|pair| pair == ["--destination", "/tmp/images"]));
        assert!(args.windows(2).any(|pair| pair == ["--cookies-from-browser", "firefox"]));
        assert!(args.windows(2).any(|pair| pair == ["--range", "1,3"]));
    }

    #[test]
    fn parses_structured_progress_without_faking_unknown_totals() {
        assert_eq!(parse_progress_percent(" 42.5%"), Some(42.5));
        assert_eq!(parse_progress_number("1234"), Some(1234));
        assert_eq!(parse_progress_number("NA"), None);
        assert_eq!(gallery_line_progress("# image.jpg", 2), Some(3));
        assert_eq!(gallery_line_progress("[debug] Starting SimulationJob", 2), None);
    }

    #[test]
    fn rejects_arbitrary_browser_values() {
        let request = AnalyzeRequest {
            url: "https://example.com/video".into(),
            auth_browser: Some("--exec=bad".into()),
            include_playlist: false,
        };
        assert!(build_analyze_args(&request).is_err());
    }

    #[test]
    fn public_requests_do_not_add_cookie_flags() {
        let request = AnalyzeRequest {
            url: "https://example.com/video".into(),
            auth_browser: None,
            include_playlist: false,
        };
        let args = build_analyze_args(&request).unwrap();
        assert!(!args.iter().any(|value| value == "--cookies-from-browser"));
    }

    #[test]
    fn playlist_analysis_is_opt_in_and_limited_to_a_probe_item() {
        let request = AnalyzeRequest {
            url: "https://example.com/playlist".into(),
            auth_browser: None,
            include_playlist: true,
        };
        let args = build_analyze_args(&request).unwrap();
        assert!(args.iter().any(|value| value == "--flat-playlist"));
        assert!(args.windows(2).any(|pair| pair == ["--playlist-end", "200"]));
        assert!(!args.iter().any(|value| value == "--no-playlist"));
    }

    #[test]
    fn maps_playlist_items_without_confusing_probe_count_for_total_count() {
        let metadata = parse_metadata(
            r#"{"_type":"playlist","title":"Demo list","playlist_count":3,"entries":[
            {"id":"a","title":"First","url":"https://example.com/a","duration":2.5},
            {"id":"b","title":"Second","url":"https://example.com/b","filesize":42}
        ]}"#,
        )
        .unwrap();
        assert_eq!(metadata.media_kind, "playlist");
        assert_eq!(metadata.collection_count, Some(3));
        assert_eq!(metadata.items.len(), 2);
        assert_eq!(metadata.items[0].index, 1);
        assert_eq!(metadata.items[1].index, 2);
        assert_eq!(metadata.items[0].title, "First");
    }

    #[test]
    fn parses_gallery_image_records() {
        let metadata = parse_gallery_metadata(
            r#"[[2,{"title":"Demo gallery"}],[3,"https://example.com/one.jpg",{"num":1,"filename":"one.jpg","extension":"jpg"}]]"#,
        )
        .unwrap();
        assert_eq!(metadata.title, "Demo gallery");
        assert_eq!(metadata.items[0].index, 1);
        assert_eq!(metadata.items[0].extension.as_deref(), Some("jpg"));
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
    fn classifies_site_neutral_availability_errors() {
        let error: serde_json::Value = serde_json::from_str(&structured_error(
            "ERROR: [Vimeo] This video is not available in your country",
        ))
        .unwrap();
        assert_eq!(error["kind"], "Region restricted");

        let error: serde_json::Value =
            serde_json::from_str(&structured_error("ERROR: No video formats found!")).unwrap();
        assert_eq!(error["kind"], "No downloadable formats");
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
