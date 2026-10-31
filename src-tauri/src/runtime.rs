use serde::Serialize;
use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

static MANAGED_ROOT: OnceLock<PathBuf> = OnceLock::new();
static DIAGNOSTIC_CACHE: OnceLock<Mutex<Option<(Instant, Vec<RuntimeDiagnostic>)>>> = OnceLock::new();

#[derive(Debug, Clone, Copy)]
pub(crate) enum BinaryKind {
    Ffmpeg,
    Ffprobe,
    YtDlp,
    GalleryDl,
    BgutilPot,
}

impl BinaryKind {
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Ffmpeg => "ffmpeg",
            Self::Ffprobe => "ffprobe",
            Self::YtDlp => "yt-dlp",
            Self::GalleryDl => "gallery-dl",
            Self::BgutilPot => "bgutil-pot",
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Ffmpeg => "FFmpeg",
            Self::Ffprobe => "FFprobe",
            Self::YtDlp => "yt-dlp",
            Self::GalleryDl => "gallery-dl",
            Self::BgutilPot => "PO-token provider",
        }
    }

    fn env_name(self) -> String {
        format!("ND_{}", self.key().to_uppercase().replace('-', "_"))
    }

    fn bundled_names(self) -> &'static [&'static str] {
        match self {
            Self::Ffmpeg => &["ffmpeg.exe", "ffmpeg"],
            Self::Ffprobe => &["ffprobe.exe", "ffprobe"],
            Self::YtDlp => &["yt-dlp.exe", "yt-dlp"],
            Self::GalleryDl => &["gallery-dl.exe", "gallery-dl"],
            Self::BgutilPot => &["bgutil-pot.exe", "bgutil-pot"],
        }
    }

    fn version_args(self) -> &'static [&'static str] {
        match self {
            Self::Ffmpeg | Self::Ffprobe => &["-version"],
            Self::YtDlp | Self::GalleryDl | Self::BgutilPot => &["--version"],
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedBinary {
    pub path: String,
    pub source: &'static str,
    pub version: String,
}

pub(crate) fn initialize(app: &AppHandle) {
    if let Ok(path) = app.path().app_data_dir() {
        let _ = MANAGED_ROOT.set(path.join("media-engines"));
    }
}

pub(crate) fn managed_root() -> Option<PathBuf> {
    if let Ok(path) = env::var("ND_MEDIA_ENGINES_DIR") {
        let path = PathBuf::from(path);
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }
    MANAGED_ROOT.get().cloned()
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostic {
    pub key: String,
    pub label: String,
    pub status: String,
    pub source: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub architecture: String,
    pub detail: Option<String>,
    pub capabilities: Vec<String>,
}

#[derive(Debug)]
struct ValidationFailure {
    status: &'static str,
    detail: String,
}

pub(crate) fn resource_path(relative: &str) -> Option<String> {
    let exe = env::current_exe().ok()?;
    let dir = exe.parent()?;
    let resource_roots = if cfg!(target_os = "macos") {
        vec![
            dir.join("../Resources"),
            dir.join("../Resources/resources"),
            dir.join("resources"),
            dir.join("../.."),
        ]
    } else {
        vec![
            dir.join("resources"),
            dir.join("../resources"),
            dir.join("resources/resources"),
            dir.join("../.."),
        ]
    };
    resource_roots
        .into_iter()
        .map(|root| root.join(relative))
        .find(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
}

pub(crate) fn resolve_path(kind: BinaryKind) -> Result<String, String> {
    resolve(kind).map(|binary| binary.path)
}

pub(crate) fn resolve_optional_path(kind: BinaryKind) -> Option<String> {
    resolve(kind).ok().map(|binary| binary.path)
}

pub(crate) fn invalidate_diagnostics_cache() {
    if let Some(cache) = DIAGNOSTIC_CACHE.get() {
        if let Ok(mut value) = cache.lock() {
            *value = None;
        }
    }
}

pub(crate) fn diagnostics() -> Vec<RuntimeDiagnostic> {
    let cache = DIAGNOSTIC_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(value) = cache.lock() {
        if let Some((created, items)) = value.as_ref() {
            if created.elapsed() < Duration::from_secs(30) {
                return items.clone();
            }
        }
    }
    let items = [
        BinaryKind::Ffmpeg,
        BinaryKind::Ffprobe,
        BinaryKind::YtDlp,
        BinaryKind::GalleryDl,
        BinaryKind::BgutilPot,
    ]
    .into_iter()
    .map(diagnose)
    .collect::<Vec<_>>();
    if let Ok(mut value) = cache.lock() {
        *value = Some((Instant::now(), items.clone()));
    }
    items
}

fn resolve(kind: BinaryKind) -> Result<ResolvedBinary, String> {
    let mut failures = Vec::new();

    if let Some(path) = managed_candidate(kind) {
        match validate(&path, kind) {
            Ok(version) => {
                if matches!(kind, BinaryKind::Ffmpeg | BinaryKind::Ffprobe)
                    && !managed_media_pair_is_compatible(kind, &version)
                {
                    failures.push(format!(
                        "managed {}: FFmpeg and FFprobe are not an active compatible pair",
                        kind.key()
                    ));
                } else {
                    return Ok(ResolvedBinary {
                        path: path.to_string_lossy().into_owned(),
                        source: "managed",
                        version,
                    });
                }
            }
            Err(failure) => failures.push(format!("managed {}: {}", kind.key(), failure.detail)),
        }
    }

    for name in kind.bundled_names() {
        if let Some(path) = resource_path(&format!("binaries/{name}")) {
            match validate(Path::new(&path), kind) {
                Ok(version) => {
                    return Ok(ResolvedBinary {
                        path,
                        source: "bundled",
                        version,
                    });
                }
                Err(failure) => failures.push(format!("bundled {name}: {}", failure.detail)),
            }
        }
    }

    if let Ok(configured) = env::var(kind.env_name()) {
        let configured = configured.trim();
        if !configured.is_empty() {
            match validate(Path::new(configured), kind) {
                Ok(version) => {
                    return Ok(ResolvedBinary {
                        path: configured.into(),
                        source: "explicit",
                        version,
                    });
                }
                Err(failure) => {
                    return Err(format!(
                        "{} ({}) at {}: {}",
                        kind.label(),
                        failure.status,
                        configured,
                        failure.detail
                    ));
                }
            }
        }
    }

    if system_fallback_allowed() {
        let command = kind
            .bundled_names()
            .iter()
            .find(|name| !name.ends_with(".exe"))
            .copied()
            .unwrap_or(kind.key());
        match validate_command(command, kind) {
            Ok(version) => {
                return Ok(ResolvedBinary {
                    path: command.into(),
                    source: "system",
                    version,
                });
            }
            Err(failure) => failures.push(format!("system {command}: {}", failure.detail)),
        }
    }

    let detail = if failures.is_empty() {
        "no bundled executable was found".to_string()
    } else {
        failures.join("; ")
    };
    Err(format!("{} unavailable: {detail}", kind.label()))
}

fn managed_media_pair_is_compatible(kind: BinaryKind, version: &str) -> bool {
    if !matches!(kind, BinaryKind::Ffmpeg | BinaryKind::Ffprobe) {
        return true;
    }
    let Some(root) = managed_root() else {
        return false;
    };
    let Ok(data) = std::fs::read(root.join("manifest.json")) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&data) else {
        return false;
    };
    let active = value.get("active").and_then(serde_json::Value::as_object);
    let Some(active) = active else {
        return false;
    };
    let Some(ffmpeg_version) = active
        .get("ffmpeg")
        .and_then(|item| item.get("version"))
        .and_then(serde_json::Value::as_str)
    else {
        return false;
    };
    let Some(ffprobe_version) = active
        .get("ffprobe")
        .and_then(|item| item.get("version"))
        .and_then(serde_json::Value::as_str)
    else {
        return false;
    };
    ffmpeg_version == version && ffprobe_version == version
}

fn managed_candidate(kind: BinaryKind) -> Option<PathBuf> {
    let root = managed_root()?;
    let manifest = root.join("manifest.json");
    let data = std::fs::read(&manifest).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&data).ok()?;
    let relative = value
        .get("active")?
        .get(kind.key())?
        .get("executable")?
        .as_str()?;
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return None;
    }
    Some(root.join(relative_path))
}

fn diagnose(kind: BinaryKind) -> RuntimeDiagnostic {
    match resolve(kind) {
        Ok(binary) => RuntimeDiagnostic {
            key: kind.key().into(),
            label: kind.label().into(),
            status: "available".into(),
            source: binary.source.into(),
            path: Some(binary.path),
            version: Some(binary.version),
            architecture: env::consts::ARCH.into(),
            detail: None,
            capabilities: capabilities(kind),
        },
        Err(error) => {
            let status = if error.contains("not executable") {
                "notExecutable"
            } else if error.contains("wrong architecture") {
                "wrongArchitecture"
            } else if error.contains("shared library") {
                "missingSharedLibrary"
            } else if error.contains("unsupported") {
                "unsupportedVersion"
            } else {
                "missing"
            };
            RuntimeDiagnostic {
                key: kind.key().into(),
                label: kind.label().into(),
                status: status.into(),
                source: "unavailable".into(),
                path: None,
                version: None,
                architecture: env::consts::ARCH.into(),
                detail: Some(error),
                capabilities: Vec::new(),
            }
        }
    }
}

fn capabilities(kind: BinaryKind) -> Vec<String> {
    match kind {
        BinaryKind::Ffmpeg => vec!["gif-palettegen".into(), "video-decode".into()],
        BinaryKind::Ffprobe => vec!["media-probe".into()],
        BinaryKind::YtDlp => vec!["url-analysis".into(), "media-download".into()],
        BinaryKind::GalleryDl => vec!["gallery-download".into()],
        BinaryKind::BgutilPot => vec!["po-token".into()],
    }
}

fn system_fallback_allowed() -> bool {
    cfg!(debug_assertions)
        || matches!(
            env::var("ND_ALLOW_SYSTEM_BINARIES").as_deref(),
            Ok("1") | Ok("true") | Ok("yes")
        )
}

fn validate(path: &Path, kind: BinaryKind) -> Result<String, ValidationFailure> {
    if !path.exists() {
        return Err(ValidationFailure {
            status: "missing",
            detail: "file does not exist".into(),
        });
    }
    if !path.is_file() {
        return Err(ValidationFailure {
            status: "missing",
            detail: "path is not a file".into(),
        });
    }
    if matches!(kind, BinaryKind::Ffmpeg | BinaryKind::Ffprobe) && is_development_wrapper(path) {
        return Err(ValidationFailure {
            status: "unsupported version",
            detail: "bundled file is a development wrapper, not a self-contained media binary"
                .into(),
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path
            .metadata()
            .map(|meta| meta.permissions().mode() & 0o111 == 0)
            .unwrap_or(true)
        {
            return Err(ValidationFailure {
                status: "not executable",
                detail: "executable permission is not set".into(),
            });
        }
    }
    run_version(path, kind)
}

pub(crate) fn health_check(path: &Path, kind: BinaryKind) -> Result<String, String> {
    validate(path, kind)
        .map_err(|failure| format!("{} ({}): {}", kind.label(), failure.status, failure.detail))
}

fn is_development_wrapper(path: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut header = [0u8; 512];
    let read = file.read(&mut header).unwrap_or(0);
    header[..read].starts_with(b"#!")
        || String::from_utf8_lossy(&header[..read]).contains("ND_FFMPEG_SYSTEM")
}

fn validate_command(command: &str, kind: BinaryKind) -> Result<String, ValidationFailure> {
    run_version(Path::new(command), kind)
}

fn run_version(path: &Path, kind: BinaryKind) -> Result<String, ValidationFailure> {
    let output = Command::new(path)
        .args(kind.version_args())
        .output()
        .map_err(|error| {
            let status = match error.kind() {
                std::io::ErrorKind::PermissionDenied => "not executable",
                std::io::ErrorKind::NotFound => "missing",
                _ => "execution blocked",
            };
            ValidationFailure {
                status,
                detail: error.to_string(),
            }
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let lower = detail.to_lowercase();
        let status = if lower.contains("bad cpu type")
            || lower.contains("exec format")
            || lower.contains("wrong architecture")
        {
            "wrong architecture"
        } else if lower.contains("library not loaded")
            || lower.contains("dll")
            || lower.contains("shared object")
        {
            "missing shared library"
        } else {
            "unsupported version"
        };
        return Err(ValidationFailure {
            status,
            detail: if detail.is_empty() {
                format!("process exited with {}", output.status)
            } else {
                detail
            },
        });
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err(ValidationFailure {
            status: "unsupported version",
            detail: "version command returned no output".into(),
        });
    }
    if matches!(kind, BinaryKind::Ffmpeg) {
        let filters = Command::new(path)
            .args(["-filters"])
            .output()
            .map_err(|error| ValidationFailure {
                status: "execution blocked",
                detail: format!("could not inspect FFmpeg filters: {error}"),
            })?;
        let filter_text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&filters.stdout),
            String::from_utf8_lossy(&filters.stderr)
        );
        if !filters.status.success()
            || !filter_text.contains("palettegen")
            || !filter_text.contains("paletteuse")
        {
            return Err(ValidationFailure {
                status: "unsupported version",
                detail: "FFmpeg does not expose palettegen/paletteuse GIF filters".into(),
            });
        }
    }
    Ok(version.lines().next().unwrap_or(&version).trim().into())
}

#[cfg(test)]
mod tests {
    use super::is_development_wrapper;
    use std::path::PathBuf;

    fn temporary_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("nd-runtime-{name}-{}", std::process::id()))
    }

    #[test]
    fn rejects_shell_wrappers_as_bundled_media_binaries() {
        let path = temporary_path("wrapper");
        std::fs::write(&path, b"#!/bin/sh\nexec ffmpeg \"$@\"\n").unwrap();
        assert!(is_development_wrapper(&path));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn accepts_non_wrapper_binary_headers() {
        let path = temporary_path("binary");
        std::fs::write(&path, b"\xCF\xFA\xED\xFE\x00\x00\x00\x02").unwrap();
        assert!(!is_development_wrapper(&path));
        let _ = std::fs::remove_file(path);
    }
}
