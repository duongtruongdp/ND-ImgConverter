use serde::Serialize;
use std::env;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

static MANAGED_ROOT: OnceLock<PathBuf> = OnceLock::new();
static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static DIAGNOSTIC_CACHE: OnceLock<Mutex<Option<(Instant, Vec<RuntimeDiagnostic>)>>> =
    OnceLock::new();

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
        if cfg!(target_os = "windows") {
            match self {
                Self::Ffmpeg => &["ffmpeg.exe"],
                Self::Ffprobe => &["ffprobe.exe"],
                Self::YtDlp => &["yt-dlp.exe"],
                Self::GalleryDl => &["gallery-dl.exe"],
                Self::BgutilPot => &["bgutil-pot.exe"],
            }
        } else {
            match self {
                Self::Ffmpeg => &["ffmpeg"],
                Self::Ffprobe => &["ffprobe"],
                Self::YtDlp => &["yt-dlp"],
                Self::GalleryDl => &["gallery-dl"],
                Self::BgutilPot => &["bgutil-pot"],
            }
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
    pub candidates: Vec<RuntimeCandidate>,
}

pub(crate) fn initialize(app: &AppHandle) {
    if let Ok(path) = app.path().app_data_dir() {
        let _ = MANAGED_ROOT.set(path.join("media-engines"));
    }
    if let Ok(path) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(path);
    }
    invalidate_diagnostics_cache();
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

pub(crate) fn resource_directory() -> Option<String> {
    RESOURCE_DIR
        .get()
        .map(|path| path.to_string_lossy().into_owned())
}

pub(crate) fn executable_directory() -> Option<String> {
    env::current_exe().ok().and_then(|path| {
        path.parent()
            .map(|parent| parent.to_string_lossy().into_owned())
    })
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
    pub candidates: Vec<RuntimeCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCandidate {
    pub path: String,
    pub exists: bool,
    pub selected: bool,
}

#[derive(Debug)]
pub(crate) struct ResolveFailure {
    pub message: String,
    pub candidates: Vec<RuntimeCandidate>,
}

#[derive(Debug)]
struct ValidationFailure {
    status: &'static str,
    detail: String,
}

pub(crate) fn resource_path(relative: &str) -> Option<String> {
    runtime_resource_roots()
        .into_iter()
        .map(|root| root.join(relative))
        .find(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
}

fn runtime_resource_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut add = |path: PathBuf| {
        if !roots.iter().any(|existing| existing == &path) {
            roots.push(path);
        }
    };

    if let Some(path) = RESOURCE_DIR.get() {
        // Tauri's resource_dir() is authoritative for packaged apps. On Windows,
        // resources configured as "binaries/foo.exe" are placed directly below it.
        add(path.clone());
        add(path.join("resources"));
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Keep the executable directory first-class: this is the Windows NSIS
            // layout observed in installed v0.9.0 packages.
            add(dir.to_path_buf());
            add(dir.join("resources"));
            if cfg!(target_os = "macos") {
                add(dir.join("../Resources"));
                add(dir.join("../Resources/resources"));
                add(dir.join("../.."));
            } else {
                add(dir.join("../resources"));
                add(dir.join("resources/resources"));
                add(dir.join("../.."));
            }
        }
    }

    roots
}

fn bundled_candidate_paths(name: &str) -> Vec<PathBuf> {
    candidate_paths_from_roots(runtime_resource_roots(), name)
}

fn candidate_paths_from_roots(roots: Vec<PathBuf>, name: &str) -> Vec<PathBuf> {
    roots
        .into_iter()
        .map(|root| root.join("binaries").join(name))
        .collect()
}

pub(crate) fn resolve_path(kind: BinaryKind) -> Result<String, String> {
    resolve(kind)
        .map(|binary| binary.path)
        .map_err(|failure| failure.message)
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

fn resolve(kind: BinaryKind) -> Result<ResolvedBinary, ResolveFailure> {
    let mut failures = Vec::new();
    let mut candidates = Vec::new();

    if let Some(path) = managed_candidate(kind) {
        let candidate_index = candidates.len();
        candidates.push(RuntimeCandidate {
            path: path.to_string_lossy().into_owned(),
            exists: path.is_file(),
            selected: false,
        });
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
                        candidates: mark_selected(candidates, candidate_index),
                    });
                }
            }
            Err(failure) => failures.push(format!(
                "managed {} ({}): {}",
                kind.key(),
                failure.status,
                failure.detail
            )),
        }
    }

    for name in kind.bundled_names() {
        for path in bundled_candidate_paths(name) {
            let candidate_index = candidates.len();
            candidates.push(RuntimeCandidate {
                path: path.to_string_lossy().into_owned(),
                exists: path.is_file(),
                selected: false,
            });
            if !path.is_file() {
                continue;
            }
            match validate(&path, kind) {
                Ok(version) => {
                    return Ok(ResolvedBinary {
                        path: path.to_string_lossy().into_owned(),
                        source: "bundled",
                        version,
                        candidates: mark_selected(candidates, candidate_index),
                    });
                }
                Err(failure) => failures.push(format!(
                    "bundled {name} ({}): {}",
                    failure.status, failure.detail
                )),
            }
        }
    }

    if let Ok(configured) = env::var(kind.env_name()) {
        let configured = configured.trim();
        if !configured.is_empty() {
            let candidate_index = candidates.len();
            candidates.push(RuntimeCandidate {
                path: configured.into(),
                exists: Path::new(configured).is_file(),
                selected: false,
            });
            match validate(Path::new(configured), kind) {
                Ok(version) => {
                    return Ok(ResolvedBinary {
                        path: configured.into(),
                        source: "explicit",
                        version,
                        candidates: mark_selected(candidates, candidate_index),
                    });
                }
                Err(failure) => {
                    return Err(ResolveFailure {
                        message: format!(
                            "{} ({}) at {}: {}",
                            kind.label(),
                            failure.status,
                            configured,
                            failure.detail
                        ),
                        candidates,
                    });
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
        let candidate_index = candidates.len();
        candidates.push(RuntimeCandidate {
            path: command.into(),
            exists: false,
            selected: false,
        });
        match validate_command(command, kind) {
            Ok(version) => {
                return Ok(ResolvedBinary {
                    path: command.into(),
                    source: "system",
                    version,
                    candidates: mark_selected(candidates, candidate_index),
                });
            }
            Err(failure) => failures.push(format!(
                "system {command} ({}): {}",
                failure.status, failure.detail
            )),
        }
    }

    let detail = if failures.is_empty() {
        "no bundled executable was found".to_string()
    } else {
        failures.join("; ")
    };
    Err(ResolveFailure {
        message: format!("{} unavailable: {detail}", kind.label()),
        candidates,
    })
}

fn mark_selected(mut candidates: Vec<RuntimeCandidate>, selected: usize) -> Vec<RuntimeCandidate> {
    if let Some(candidate) = candidates.get_mut(selected) {
        candidate.selected = true;
    }
    candidates
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
            candidates: binary.candidates,
        },
        Err(error) => {
            let status = if error.message.contains("not executable") {
                "notExecutable"
            } else if error.message.contains("wrong architecture") {
                "wrongArchitecture"
            } else if error.message.contains("shared library") {
                "missingSharedLibrary"
            } else if error.message.contains("execution blocked")
                || error.message.contains("execution timed out")
            {
                "healthCheckFailed"
            } else if error.message.contains("unsupported") {
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
                detail: Some(error.message),
                capabilities: Vec::new(),
                candidates: error.candidates,
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

const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

fn run_command(path: &Path, args: &[&str]) -> Result<Output, ValidationFailure> {
    let mut child = Command::new(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
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
    let stdout = child.stdout.take().map(|mut stream| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes).map(|_| bytes)
        })
    });
    let stderr = child.stderr.take().map(|mut stream| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes).map(|_| bytes)
        })
    });

    let deadline = Instant::now() + HEALTH_CHECK_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout.and_then(|handle| handle.join().ok());
                let _ = stderr.and_then(|handle| handle.join().ok());
                return Err(ValidationFailure {
                    status: "execution timed out",
                    detail: format!(
                        "health check exceeded {} seconds",
                        HEALTH_CHECK_TIMEOUT.as_secs()
                    ),
                });
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout.and_then(|handle| handle.join().ok());
                let _ = stderr.and_then(|handle| handle.join().ok());
                return Err(ValidationFailure {
                    status: "execution blocked",
                    detail: error.to_string(),
                });
            }
        }
    };

    Ok(Output {
        status,
        stdout: collect_output(stdout)?,
        stderr: collect_output(stderr)?,
    })
}

fn collect_output(
    handle: Option<std::thread::JoinHandle<io::Result<Vec<u8>>>>,
) -> Result<Vec<u8>, ValidationFailure> {
    let Some(handle) = handle else {
        return Ok(Vec::new());
    };
    handle
        .join()
        .map_err(|_| ValidationFailure {
            status: "execution blocked",
            detail: "output reader panicked".into(),
        })?
        .map_err(|error| ValidationFailure {
            status: "execution blocked",
            detail: format!("could not read process output: {error}"),
        })
}

fn run_version(path: &Path, kind: BinaryKind) -> Result<String, ValidationFailure> {
    let output = run_command(path, kind.version_args())?;
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
    let version = {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stdout.is_empty() {
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        } else {
            stdout
        }
    };
    if version.is_empty() {
        return Err(ValidationFailure {
            status: "unsupported version",
            detail: "version command returned no output".into(),
        });
    }
    if matches!(kind, BinaryKind::Ffmpeg) {
        let filters = run_command(path, &["-filters"]).map_err(|failure| ValidationFailure {
            status: failure.status,
            detail: format!("could not inspect FFmpeg filters: {}", failure.detail),
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
    use super::{candidate_paths_from_roots, is_development_wrapper};
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

    #[test]
    fn installed_root_binaries_are_checked_before_legacy_resource_prefixes() {
        let root = temporary_path("installed-root");
        let binaries = root.join("binaries");
        std::fs::create_dir_all(&binaries).unwrap();
        let binary = binaries.join("ffmpeg.exe");
        std::fs::write(&binary, b"MZ").unwrap();

        // This is the v0.9.0 Windows failure: the resolver searched only below
        // resources/, so the confirmed NSIS layout was invisible.
        let legacy = candidate_paths_from_roots(vec![root.join("resources")], "ffmpeg.exe");
        assert!(legacy.iter().all(|path| !path.exists()));

        let fixed =
            candidate_paths_from_roots(vec![root.clone(), root.join("resources")], "ffmpeg.exe");
        assert_eq!(fixed.first(), Some(&binary));
        assert!(fixed.first().is_some_and(|path| path.is_file()));

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_bundled_names_never_fall_back_to_extensionless_wrappers() {
        for kind in [
            BinaryKind::Ffmpeg,
            BinaryKind::Ffprobe,
            BinaryKind::YtDlp,
            BinaryKind::GalleryDl,
            BinaryKind::BgutilPot,
        ] {
            assert!(kind
                .bundled_names()
                .iter()
                .all(|name| name.ends_with(".exe")));
        }
    }
}
