use crate::runtime::{self, BinaryKind, RuntimeDiagnostic};
use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MANIFEST_SCHEMA: u32 = 2;
const STAGING_DIR: &str = "staging";
const MIN_FREE_SPACE: u64 = 64 * 1024 * 1024;
const CHECK_INTERVAL_SECONDS: u64 = 24 * 60 * 60;
static UPDATE_LOCK: Mutex<()> = Mutex::new(());
static DOWNLOAD_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static DOWNLOAD_BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSignature {
    pub algorithm: String,
    pub key_id: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineAsset {
    pub engine: String,
    pub package_id: String,
    pub version: String,
    pub channel: String,
    pub platform: String,
    pub architecture: String,
    pub download_url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub publisher: String,
    pub min_app_version: String,
    pub companions: Vec<String>,
    pub license: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineUpdateManifest {
    pub schema_version: u32,
    pub channel: String,
    pub manifest_revision: u64,
    pub published_at: u64,
    pub expires_at: u64,
    pub generated_at: String,
    pub publisher: String,
    pub signature: Option<ManifestSignature>,
    pub assets: Vec<EngineAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ActiveManifest {
    schema_version: u32,
    active: BTreeMap<String, ActiveEngine>,
    previous: BTreeMap<String, ActiveEngine>,
    updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveEngine {
    version: String,
    executable: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub key: String,
    pub label: String,
    pub installed_version: Option<String>,
    pub status: String,
    pub source: String,
    pub path: Option<String>,
    pub rollback_available: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub state: String,
    pub checked_at: Option<String>,
    pub message: String,
    pub updates: Vec<EngineAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub asset: EngineAsset,
    pub staged_path: String,
    pub active_jobs: u32,
}

fn host_is_allowed(host: &str, allowed_hosts: &[String]) -> bool {
    allowed_hosts
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host))
}

fn is_private_ip(host: &str) -> bool {
    let Ok(address) = host.parse::<std::net::IpAddr>() else {
        return false;
    };
    match address {
        std::net::IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_broadcast()
        }
        std::net::IpAddr::V6(address) => {
            address.is_loopback()
                || address.is_unspecified()
                || address.is_unique_local()
                || address.is_unicast_link_local()
        }
    }
}

pub(crate) async fn download_asset<F>(
    asset: &EngineAsset,
    allowed_hosts: &[String],
    cancel: &AtomicBool,
    mut progress: F,
) -> Result<String, String>
where
    F: FnMut(u64, u64),
{
    validate_asset_shape(asset)?;
    if !asset_matches_target(asset) {
        return Err("Update architecture or platform does not match this app.".into());
    }
    if !asset_supported_by_app(asset) {
        return Err("This engine update requires a newer version of the app.".into());
    }
    let url = reqwest::Url::parse(&asset.download_url)
        .map_err(|error| format!("update URL is invalid: {error}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| "update URL has no host".to_string())?;
    let local_test = matches!(
        std::env::var("ND_ENGINE_UPDATE_TEST_LOCAL").as_deref(),
        Ok("1") | Ok("true")
    );
    if !host_is_allowed(host, allowed_hosts) {
        return Err("update host is not allowlisted by the trusted manifest".into());
    }
    if !local_test && is_private_ip(host) {
        return Err("private or local update destinations are blocked".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || attempt.url().scheme() != "https" {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| format!("could not create secure update client: {error}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("engine download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "engine download failed with HTTP {}",
            response.status()
        ));
    }
    if response.url().scheme() != "https" {
        return Err("engine download redirected to a non-HTTPS URL".into());
    }
    let final_host = response
        .url()
        .host_str()
        .ok_or_else(|| "engine download has no final host".to_string())?;
    if !host_is_allowed(final_host, allowed_hosts) {
        return Err("engine download redirected to an untrusted host".into());
    }
    let total = response
        .content_length()
        .or((asset.size_bytes > 0).then_some(asset.size_bytes))
        .unwrap_or(0);
    let max_bytes = if asset.size_bytes > 0 {
        asset.size_bytes
    } else {
        2 * 1024 * 1024 * 1024
    };
    if total > max_bytes {
        return Err("engine download exceeds the configured size limit".into());
    }
    let root = runtime::managed_root()
        .ok_or_else(|| "managed media-engine directory is not initialized".to_string())?;
    if let Some(free) = available_space(&root) {
        let expected = if asset.size_bytes > 0 {
            asset.size_bytes
        } else {
            total
        };
        if expected > 0 && free < expected.saturating_add(MIN_FREE_SPACE) {
            return Err("Not enough free space for this engine download.".into());
        }
    }
    let staging = root.join(STAGING_DIR).join(format!(
        "download-{}-{}-{}",
        asset.engine,
        asset.version,
        std::process::id()
    ));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let target = staging.join(format!("{}.part", asset.file_name));
    let mut file = fs::File::create(&target).map_err(|error| error.to_string())?;
    let mut received = 0u64;
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("engine download interrupted: {error}"))?
    {
        if cancel.load(Ordering::SeqCst) {
            return Err("engine download cancelled".into());
        }
        received = received.saturating_add(chunk.len() as u64);
        if received > max_bytes {
            return Err("engine download exceeds the configured size limit".into());
        }
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        progress(received, total);
    }
    file.flush().map_err(|error| error.to_string())?;
    if asset.size_bytes > 0 && received != asset.size_bytes {
        return Err("downloaded engine size does not match the trusted manifest".into());
    }
    let verified = staging.join(&asset.file_name);
    fs::rename(&target, &verified).map_err(|error| error.to_string())?;
    verify_asset_file(&verified, asset)?;
    Ok(verified.to_string_lossy().into_owned())
}

pub(crate) async fn download_verified_asset<F>(
    asset: &EngineAsset,
    cancel: &AtomicBool,
    progress: F,
) -> Result<String, String>
where
    F: FnMut(u64, u64),
{
    if DOWNLOAD_BUSY.swap(true, Ordering::SeqCst) {
        return Err("Another engine update is already in progress.".into());
    }
    let result = download_verified_asset_inner(asset, cancel, progress).await;
    DOWNLOAD_BUSY.store(false, Ordering::SeqCst);
    result
}

async fn download_verified_asset_inner<F>(
    asset: &EngineAsset,
    cancel: &AtomicBool,
    progress: F,
) -> Result<String, String>
where
    F: FnMut(u64, u64),
{
    let _download_guard = DOWNLOAD_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    cancel.store(false, Ordering::SeqCst);
    if !trusted_manifest_enabled() {
        return Err("Verified engine updates are disabled until a trusted publisher key is configured.".into());
    }
    let manifest = if let Some(path) = std::env::var_os("ND_ENGINE_UPDATE_MANIFEST") {
        let data = fs::read(path).map_err(|error| format!("couldn't read the trusted update manifest: {error}"))?;
        serde_json::from_slice(&data).map_err(|error| format!("the trusted update manifest is invalid: {error}"))?
    } else {
        let root = runtime::managed_root().ok_or_else(|| "managed media-engine directory is not initialized".to_string())?;
        load_cached_manifest(&root)?
    };
    verify_manifest(&manifest)?;
    let verified = manifest
        .assets
        .iter()
        .find(|candidate| *candidate == asset)
        .ok_or_else(|| "The requested engine asset is not present in the verified manifest.".to_string())?;
    let host = reqwest::Url::parse(&verified.download_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .ok_or_else(|| "The verified engine asset has no valid download host.".to_string())?;
    download_asset(verified, &[host], cancel, progress).await
}

fn now_string() -> String {
    now_seconds().to_string()
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn active_manifest_path(root: &Path) -> PathBuf {
    root.join("manifest.json")
}

fn check_state_path(root: &Path) -> PathBuf {
    root.join("check-state.json")
}

fn verified_manifest_cache_path(root: &Path) -> PathBuf {
    root.join(STAGING_DIR).join("verified-manifest.json")
}

fn recent_check(root: &Path) -> Option<String> {
    let data = fs::read(check_state_path(root)).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&data).ok()?;
    let last = value.get("lastChecked")?.as_u64()?;
    if now_seconds().saturating_sub(last) < CHECK_INTERVAL_SECONDS {
        Some(last.to_string())
    } else {
        None
    }
}

fn accepted_revision(root: &Path) -> Option<u64> {
    let data = fs::read(check_state_path(root)).ok()?;
    serde_json::from_slice::<serde_json::Value>(&data)
        .ok()?
        .get("manifestRevision")
        .and_then(serde_json::Value::as_u64)
}

fn record_check(root: &Path, revision: u64) {
    let _ = write_atomic(
        &check_state_path(root),
        &serde_json::json!({ "lastChecked": now_seconds(), "manifestRevision": revision }),
    );
}

fn configured_manifest_url() -> Option<String> {
    std::env::var("ND_ENGINE_UPDATE_MANIFEST_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn configured_manifest_host() -> Option<String> {
    std::env::var("ND_ENGINE_UPDATE_HOST")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

async fn fetch_manifest_bytes() -> Result<Vec<u8>, String> {
    if let Some(path) = std::env::var_os("ND_ENGINE_UPDATE_MANIFEST") {
        return fs::read(path).map_err(|error| format!("Couldn't read the update manifest: {error}"));
    }
    let url = configured_manifest_url().ok_or_else(|| "No update manifest is configured.".to_string())?;
    let parsed = reqwest::Url::parse(&url).map_err(|error| format!("update manifest URL is invalid: {error}"))?;
    if parsed.scheme() != "https" {
        return Err("update manifest URL must use HTTPS".into());
    }
    let expected_host = configured_manifest_host().ok_or_else(|| "update manifest host is not configured".to_string())?;
    let host = parsed.host_str().ok_or_else(|| "update manifest URL has no host".to_string())?;
    let local_test = matches!(
        std::env::var("ND_ENGINE_UPDATE_TEST_LOCAL").as_deref(),
        Ok("1") | Ok("true")
    );
    if !host.eq_ignore_ascii_case(&expected_host) {
        return Err("update manifest host is not allowlisted".into());
    }
    if !local_test && is_private_ip(host) {
        return Err("private or local update manifest destinations are blocked".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 || attempt.url().scheme() != "https" {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| format!("could not create secure manifest client: {error}"))?;
    let response = client
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("update manifest request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("update manifest request failed with HTTP {}", response.status()));
    }
    if response.url().scheme() != "https"
        || response
            .url()
            .host_str()
            .is_none_or(|value| !value.eq_ignore_ascii_case(&expected_host))
    {
        return Err("update manifest redirected to an untrusted destination".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("could not read update manifest: {error}"))?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("update manifest exceeds the configured size limit".into());
    }
    Ok(bytes.to_vec())
}

fn load_cached_manifest(root: &Path) -> Result<EngineUpdateManifest, String> {
    let data = fs::read(verified_manifest_cache_path(root))
        .map_err(|error| format!("no verified update manifest cache is available: {error}"))?;
    serde_json::from_slice(&data).map_err(|error| format!("cached update manifest is invalid: {error}"))
}

fn load_active(root: &Path) -> ActiveManifest {
    fs::read(active_manifest_path(root))
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_else(|| ActiveManifest {
            schema_version: MANIFEST_SCHEMA,
            ..ActiveManifest::default()
        })
}

fn write_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "missing manifest parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temp = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id()
    ));
    let data = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temp, data).map_err(|error| error.to_string())?;
    fs::rename(&temp, path).map_err(|error| error.to_string())
}

fn safe_component(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn verify_asset_file(path: &Path, asset: &EngineAsset) -> Result<(), String> {
    if !path.is_file() {
        return Err("staged engine file is missing".into());
    }
    if asset.sha256.len() != 64
        || !asset
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("manifest checksum is invalid".into());
    }
    if asset.size_bytes > 0
        && fs::metadata(path).map_err(|error| error.to_string())?.len() != asset.size_bytes
    {
        return Err("engine size does not match the trusted manifest".into());
    }
    let actual = sha256_file(path)?;
    if !actual.eq_ignore_ascii_case(&asset.sha256) {
        return Err("engine checksum does not match the trusted manifest".into());
    }
    Ok(())
}

fn validate_asset_shape(asset: &EngineAsset) -> Result<(), String> {
    for value in [
        &asset.engine,
        &asset.package_id,
        &asset.version,
        &asset.channel,
        &asset.platform,
        &asset.architecture,
        &asset.file_name,
    ] {
        if !safe_component(value) {
            return Err("manifest contains an unsafe path or identifier".into());
        }
    }
    if asset.package_id != asset.engine && asset.package_id != "ffmpeg-suite" {
        return Err("manifest contains an unknown engine package identity".into());
    }
    if asset.channel != "stable" {
        return Err("only the stable update channel is accepted by default".into());
    }
    if !asset.download_url.starts_with("https://")
        || asset.download_url.chars().any(char::is_whitespace)
    {
        return Err("update URL must be an HTTPS URL without whitespace".into());
    }
    if asset.sha256.len() != 64
        || !asset
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("manifest checksum is invalid".into());
    }
    Ok(())
}

fn current_platform() -> (&'static str, &'static str) {
    (std::env::consts::OS, std::env::consts::ARCH)
}

fn asset_matches_target(asset: &EngineAsset) -> bool {
    let (platform, architecture) = current_platform();
    let architecture_matches = asset.architecture == "universal"
        || asset.architecture == architecture
        || (asset.architecture == "arm64" && architecture == "aarch64");
    (asset.platform == platform || asset.platform == "universal") && architecture_matches
}

fn asset_supported_by_app(asset: &EngineAsset) -> bool {
    asset.min_app_version.trim().is_empty()
        || compare_versions(env!("CARGO_PKG_VERSION"), &asset.min_app_version)
            != std::cmp::Ordering::Less
}

fn trusted_manifest_enabled() -> bool {
    matches!(
        std::env::var("ND_ENABLE_ENGINE_UPDATES").as_deref(),
        Ok("1") | Ok("true") | Ok("yes")
    )
}

fn configured_channel() -> Option<String> {
    std::env::var("ND_ENGINE_UPDATE_CHANNEL")
        .ok()
        .or_else(|| option_env!("ND_ENGINE_UPDATE_CHANNEL").map(str::to_string))
        .filter(|value| matches!(value.as_str(), "staging" | "production"))
}

fn is_revoked_key(key_id: &str) -> bool {
    std::env::var("ND_ENGINE_UPDATE_REVOKED_KEY_IDS")
        .ok()
        .or_else(|| option_env!("ND_ENGINE_UPDATE_REVOKED_KEY_IDS").map(str::to_string))
        .map(|value| key_id_is_revoked(key_id, &value))
        .unwrap_or(false)
}

fn key_id_is_revoked(key_id: &str, revoked_key_ids: &str) -> bool {
    revoked_key_ids
        .split(',')
        .any(|item| item.trim() == key_id)
}

fn validate_manifest_window(published_at: u64, expires_at: u64, now: u64) -> Result<(), String> {
    if published_at > now.saturating_add(300) {
        return Err("update manifest publication time is in the future".into());
    }
    if expires_at <= now || expires_at <= published_at {
        return Err("update manifest has expired or invalid validity bounds".into());
    }
    Ok(())
}

fn manifest_revision_is_older(candidate: u64, accepted: u64) -> bool {
    candidate < accepted
}

fn canonical_manifest_bytes(manifest: &EngineUpdateManifest) -> Result<Vec<u8>, String> {
    let mut unsigned = manifest.clone();
    unsigned.signature = None;
    serde_json::to_vec(&unsigned).map_err(|error| error.to_string())
}

fn verify_manifest_signature(
    manifest: &EngineUpdateManifest,
    public_key: &[u8],
) -> Result<(), String> {
    let key_bytes: [u8; 32] = public_key
        .try_into()
        .map_err(|_| "publisher public key must be 32 bytes".to_string())?;
    let key = VerifyingKey::from_bytes(&key_bytes)
        .map_err(|error| format!("publisher public key is invalid: {error}"))?;
    let signature = manifest
        .signature
        .as_ref()
        .ok_or_else(|| "update manifest has no publisher signature".to_string())?;
    if signature.algorithm != "ed25519" || signature.value.is_empty() || signature.key_id.is_empty()
    {
        return Err("update manifest signature metadata is invalid".into());
    }
    let signature_bytes = base64::engine::general_purpose::STANDARD
        .decode(&signature.value)
        .map_err(|error| format!("publisher signature is not valid base64: {error}"))?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|error| format!("publisher signature has invalid length: {error}"))?;
    key.verify(&canonical_manifest_bytes(manifest)?, &signature)
        .map_err(|error| format!("publisher signature verification failed: {error}"))
}

fn verify_manifest(manifest: &EngineUpdateManifest) -> Result<(), String> {
    if !trusted_manifest_enabled() {
        return Err("verified engine updates are disabled by default".into());
    }
    if manifest.schema_version != MANIFEST_SCHEMA {
        return Err("unsupported update manifest schema".into());
    }
    if configured_channel().as_deref() != Some(manifest.channel.as_str()) {
        return Err("update manifest channel is not trusted by this build".into());
    }
    if manifest.manifest_revision == 0 {
        return Err("update manifest revision is missing".into());
    }
    validate_manifest_window(manifest.published_at, manifest.expires_at, now_seconds())?;
    let Some(public_key) = std::env::var("ND_ENGINE_UPDATE_PUBLIC_KEY")
        .ok()
        .or_else(|| option_env!("ND_ENGINE_UPDATE_PUBLIC_KEY").map(str::to_string)) else {
        return Err("publisher public key is not configured".into());
    };
    let public_key = base64::engine::general_purpose::STANDARD
        .decode(public_key)
        .map_err(|error| format!("publisher public key is not valid base64: {error}"))?;
    let expected_key_id = std::env::var("ND_ENGINE_UPDATE_KEY_ID")
        .ok()
        .or_else(|| option_env!("ND_ENGINE_UPDATE_KEY_ID").map(str::to_string))
        .ok_or_else(|| "publisher key id is not configured".to_string())?;
    if manifest
        .signature
        .as_ref()
        .map(|signature| signature.key_id.as_str())
        != Some(expected_key_id.as_str())
    {
        return Err("update manifest uses an unknown signing key".into());
    }
    if is_revoked_key(&expected_key_id) {
        return Err("update manifest signing key has been revoked".into());
    }
    verify_manifest_signature(manifest, &public_key)
}

fn verified_manifest_asset(asset: &EngineAsset) -> Result<(), String> {
    if !trusted_manifest_enabled() {
        return Err("verified engine updates are disabled by default".into());
    }
    let manifest = if let Some(path) = std::env::var_os("ND_ENGINE_UPDATE_MANIFEST") {
        let data = fs::read(path).map_err(|error| format!("couldn't read the trusted update manifest: {error}"))?;
        serde_json::from_slice(&data).map_err(|error| format!("the trusted update manifest is invalid: {error}"))?
    } else {
        let root = runtime::managed_root().ok_or_else(|| "managed media-engine directory is not initialized".to_string())?;
        load_cached_manifest(&root)?
    };
    verify_manifest(&manifest)?;
    if manifest.assets.iter().any(|candidate| candidate == asset) {
        Ok(())
    } else {
        Err("the requested engine asset is not present in the verified manifest".into())
    }
}

pub(crate) fn validate_install_asset(asset: &EngineAsset) -> Result<(), String> {
    verified_manifest_asset(asset)
}

fn available_space(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("df")
            .args(["-Pk", path.to_string_lossy().as_ref()])
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout
            .lines()
            .nth(1)?
            .split_whitespace()
            .collect::<Vec<_>>();
        return line
            .get(3)
            .and_then(|value| value.parse::<u64>().ok())
            .map(|kilobytes| kilobytes * 1024);
    }
    #[cfg(not(unix))]
    {
        None
    }
}

pub(crate) fn inventory() -> Vec<EngineStatus> {
    let previous = runtime::managed_root()
        .map(|root| load_active(&root).previous)
        .unwrap_or_default();
    runtime::diagnostics()
        .into_iter()
        .map(|item: RuntimeDiagnostic| EngineStatus {
            key: item.key.clone(),
            label: item.label,
            installed_version: item.version,
            status: item.status,
            source: item.source,
            path: item.path,
            rollback_available: previous.contains_key(&item.key),
            detail: item.detail,
        })
        .collect()
}

pub(crate) async fn check_updates() -> UpdateCheckResult {
    let checked_at = Some(now_string());
    if !trusted_manifest_enabled() {
        return UpdateCheckResult {
            state: "disabled".into(),
            checked_at,
            message: "Verified engine updates are off until a trusted publisher key is configured."
                .into(),
            updates: Vec::new(),
        };
    }
    if std::env::var_os("ND_ENGINE_UPDATE_MANIFEST").is_none() && configured_manifest_url().is_none() {
        return UpdateCheckResult {
            state: "offline".into(),
            checked_at,
            message: "No update manifest is configured.".into(),
            updates: Vec::new(),
        };
    }
    if let Some(root) = runtime::managed_root() {
        if let Some(last) = recent_check(&root) {
            return UpdateCheckResult {
                state: "upToDate".into(),
                checked_at: Some(last),
                message: "Checked recently. Nothing new to install.".into(),
                updates: Vec::new(),
            };
        }
    }
    let data = match fetch_manifest_bytes().await {
        Ok(data) => data,
        Err(error) => {
            return UpdateCheckResult {
                state: "failed".into(),
                checked_at,
                message: format!("Couldn't read the update manifest: {error}"),
                updates: Vec::new(),
            }
        }
    };
    let manifest: EngineUpdateManifest = match serde_json::from_slice(&data) {
        Ok(manifest) => manifest,
        Err(error) => {
            return UpdateCheckResult {
                state: "failed".into(),
                checked_at,
                message: format!("The update manifest is invalid: {error}"),
                updates: Vec::new(),
            }
        }
    };
    if let Err(error) = verify_manifest(&manifest) {
        return UpdateCheckResult {
            state: "failed".into(),
            checked_at,
            message: error,
            updates: Vec::new(),
        };
    }
    if let Some(root) = runtime::managed_root() {
        if accepted_revision(&root)
            .is_some_and(|revision| manifest_revision_is_older(manifest.manifest_revision, revision))
        {
            return UpdateCheckResult {
                state: "failed".into(),
                checked_at,
                message: "The update manifest revision is older than the last accepted revision.".into(),
                updates: Vec::new(),
            };
        }
        if let Err(error) = write_atomic(&verified_manifest_cache_path(&root), &manifest) {
            return UpdateCheckResult {
                state: "failed".into(),
                checked_at,
                message: format!("Couldn't cache the verified update manifest: {error}"),
                updates: Vec::new(),
            };
        }
        record_check(&root, manifest.manifest_revision);
    }
    let installed = inventory()
        .into_iter()
        .map(|item| (item.key, item.installed_version))
        .collect::<BTreeMap<_, _>>();
    let updates: Vec<EngineAsset> = manifest
        .assets
        .iter()
        .filter(|asset| {
            validate_asset_shape(asset).is_ok()
                && asset_matches_target(asset)
                && asset_supported_by_app(asset)
                && installed
                    .get(&asset.engine)
                    .and_then(|version| version.as_deref())
                    .map(|version| {
                        compare_versions(&asset.version, version) == std::cmp::Ordering::Greater
                    })
                    .unwrap_or(true)
        })
        .cloned()
        .collect();
    let has_updates = !updates.is_empty();
    UpdateCheckResult {
        state: if has_updates { "updateAvailable" } else { "upToDate" }.into(),
        checked_at,
        message: if has_updates { "An engine update is ready." } else { "Everything is up to date." }.into(),
        updates,
    }
}

pub(crate) fn install_from_staging(request: InstallRequest) -> Result<EngineStatus, String> {
    let _guard = UPDATE_LOCK
        .lock()
        .map_err(|_| "engine update lock is poisoned".to_string())?;
    if request.active_jobs > 0 {
        return Err("Update deferred while a media job is running.".into());
    }
    validate_asset_shape(&request.asset)?;
    if !asset_matches_target(&request.asset) {
        return Err("Update architecture or platform does not match this app.".into());
    }
    if !asset_supported_by_app(&request.asset) {
        return Err("This engine update requires a newer version of the app.".into());
    }
    let source = PathBuf::from(&request.staged_path);
    verify_asset_file(&source, &request.asset)?;
    let root = runtime::managed_root()
        .ok_or_else(|| "managed media-engine directory is not initialized".to_string())?;
    let mut active = load_active(&root);
    if let Some(current) = active.active.get(&request.asset.engine) {
        if compare_versions(&request.asset.version, &current.version) == std::cmp::Ordering::Less {
            return Err("Engine downgrade is blocked; use Restore Previous for an explicit local rollback.".into());
        }
    }
    let required = fs::metadata(&source)
        .map_err(|error| error.to_string())?
        .len()
        .saturating_add(MIN_FREE_SPACE);
    if let Some(free) = available_space(&root) {
        if free < required {
            return Err("Not enough free space for this engine update.".into());
        }
    }
    let staging = root.join(STAGING_DIR).join(format!(
        "{}-{}-{}",
        request.asset.engine,
        request.asset.version,
        std::process::id()
    ));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    let staged_copy = staging.join(&request.asset.file_name);
    fs::copy(&source, &staged_copy).map_err(|error| error.to_string())?;
    verify_asset_file(&staged_copy, &request.asset)?;
    let version_dir = root
        .join(&request.asset.engine)
        .join(&request.asset.version);
    fs::create_dir_all(&version_dir).map_err(|error| error.to_string())?;
    let target = version_dir.join(&request.asset.file_name);
    fs::rename(&staged_copy, &target).map_err(|error| error.to_string())?;
    if let Some(kind) = kind_for_engine(&request.asset.engine) {
        runtime::health_check(&target, kind)?;
    }
    if let Some(previous) = active.active.insert(
        request.asset.engine.clone(),
        ActiveEngine {
            version: request.asset.version.clone(),
            executable: format!(
                "{}/{}/{}",
                request.asset.engine, request.asset.version, request.asset.file_name
            ),
        },
    ) {
        active
            .previous
            .insert(request.asset.engine.clone(), previous);
    }
    active.schema_version = MANIFEST_SCHEMA;
    active.updated_at = Some(now_string());
    write_atomic(&active_manifest_path(&root), &active)?;
    runtime::invalidate_diagnostics_cache();
    let _ = fs::remove_dir_all(&staging);
    Ok(inventory()
        .into_iter()
        .find(|item| item.key == request.asset.engine)
        .unwrap_or_else(|| EngineStatus {
            key: request.asset.engine.clone(),
            label: request.asset.engine.clone(),
            installed_version: Some(request.asset.version),
            status: "installed".into(),
            source: "managed".into(),
            path: Some(target.to_string_lossy().into_owned()),
            rollback_available: true,
            detail: None,
        }))
}

pub(crate) fn rollback(engine: &str) -> Result<EngineStatus, String> {
    let _guard = UPDATE_LOCK
        .lock()
        .map_err(|_| "engine update lock is poisoned".to_string())?;
    if !safe_component(engine) {
        return Err("invalid engine identifier".into());
    }
    let root = runtime::managed_root()
        .ok_or_else(|| "managed media-engine directory is not initialized".to_string())?;
    let mut active = load_active(&root);
    let previous = active
        .previous
        .remove(engine)
        .ok_or_else(|| "No previous engine version is available.".to_string())?;
    let current = active.active.insert(engine.to_string(), previous);
    if let Some(current) = current {
        active.previous.insert(engine.to_string(), current);
    }
    active.updated_at = Some(now_string());
    write_atomic(&active_manifest_path(&root), &active)?;
    runtime::invalidate_diagnostics_cache();
    inventory()
        .into_iter()
        .find(|item| item.key == engine)
        .ok_or_else(|| "Engine is no longer available after rollback.".into())
}

pub(crate) fn cleanup_staging() -> Result<(), String> {
    let _guard = UPDATE_LOCK
        .lock()
        .map_err(|_| "engine update lock is poisoned".to_string())?;
    let Some(root) = runtime::managed_root() else {
        return Ok(());
    };
    let staging = root.join(STAGING_DIR);
    if !staging.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(staging).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            fs::remove_dir_all(path).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn compare_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let parse = |value: &str| {
        value
            .split(['.', '-', '_'])
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let a = parse(left);
    let b = parse(right);
    for index in 0..a.len().max(b.len()) {
        match a.get(index).unwrap_or(&0).cmp(b.get(index).unwrap_or(&0)) {
            std::cmp::Ordering::Equal => continue,
            order => return order,
        }
    }
    std::cmp::Ordering::Equal
}

pub(crate) fn kind_for_engine(engine: &str) -> Option<BinaryKind> {
    match engine {
        "ffmpeg" => Some(BinaryKind::Ffmpeg),
        "ffprobe" => Some(BinaryKind::Ffprobe),
        "yt-dlp" => Some(BinaryKind::YtDlp),
        "gallery-dl" => Some(BinaryKind::GalleryDl),
        "bgutil-pot" => Some(BinaryKind::BgutilPot),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn asset() -> EngineAsset {
        EngineAsset {
            engine: "yt-dlp".into(),
            package_id: "yt-dlp".into(),
            version: "2026.1".into(),
            channel: "stable".into(),
            platform: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
            download_url: "https://updates.example.invalid/yt-dlp".into(),
            sha256: "a".repeat(64),
            size_bytes: 0,
            publisher: "ND release".into(),
            min_app_version: "0.9.0".into(),
            companions: Vec::new(),
            license: "Unlicense".into(),
            file_name: "yt-dlp".into(),
        }
    }

    #[test]
    fn compares_numeric_versions() {
        assert_eq!(
            compare_versions("2026.10.2", "2026.9.99"),
            std::cmp::Ordering::Greater
        );
    }

    #[test]
    fn rejects_path_traversal_and_non_https_assets() {
        let mut item = asset();
        item.file_name = "../yt-dlp".into();
        assert!(validate_asset_shape(&item).is_err());
        item.file_name = "yt-dlp".into();
        item.download_url = "file:///tmp/engine".into();
        assert!(validate_asset_shape(&item).is_err());
    }

    #[test]
    fn rejects_unsigned_manifest_even_when_update_is_not_enabled() {
        let manifest = EngineUpdateManifest {
            schema_version: MANIFEST_SCHEMA,
            channel: "staging".into(),
            manifest_revision: 1,
            published_at: now_seconds(),
            expires_at: now_seconds() + 3600,
            generated_at: "0".into(),
            publisher: "ND".into(),
            signature: None,
            assets: vec![asset()],
        };
        assert!(verify_manifest(&manifest).is_err());
    }

    #[test]
    fn verifies_canonical_signed_manifest_and_rejects_modified_metadata() {
        let signing = SigningKey::from_bytes(&[7u8; 32]);
        let mut manifest = EngineUpdateManifest {
            schema_version: MANIFEST_SCHEMA,
            channel: "staging".into(),
            manifest_revision: 1,
            published_at: now_seconds(),
            expires_at: now_seconds() + 3600,
            generated_at: "0".into(),
            publisher: "ND".into(),
            signature: None,
            assets: vec![asset()],
        };
        let signature = signing.sign(&canonical_manifest_bytes(&manifest).unwrap());
        manifest.signature = Some(ManifestSignature {
            algorithm: "ed25519".into(),
            key_id: "test-key".into(),
            value: base64::engine::general_purpose::STANDARD.encode(signature.to_bytes()),
        });
        assert!(verify_manifest_signature(&manifest, signing.verifying_key().as_bytes()).is_ok());
        manifest.assets[0].version = "2026.2".into();
        assert!(verify_manifest_signature(&manifest, signing.verifying_key().as_bytes()).is_err());
    }

    #[test]
    fn rejects_expired_or_future_manifest_windows() {
        assert!(validate_manifest_window(90, 110, 100).is_ok());
        assert!(validate_manifest_window(90, 100, 100).is_err());
        assert!(validate_manifest_window(401, 500, 100).is_err());
    }

    #[test]
    fn rejects_revoked_signing_key_ids() {
        assert!(key_id_is_revoked("old-key", "other, old-key, retired"));
        assert!(!key_id_is_revoked("new-key", "other, old-key, retired"));
    }

    #[test]
    fn rejects_manifest_revision_replay() {
        assert!(manifest_revision_is_older(41, 42));
        assert!(!manifest_revision_is_older(42, 42));
        assert!(!manifest_revision_is_older(43, 42));
    }

    #[test]
    fn target_matching_is_deterministic() {
        let item = asset();
        assert!(asset_matches_target(&item));
    }

    #[test]
    fn verifies_checksum_and_size_before_install() {
        let path = std::env::temp_dir().join(format!("nd-engine-checksum-{}", std::process::id()));
        fs::write(&path, b"trusted-engine").unwrap();
        let mut item = asset();
        item.size_bytes = 14;
        item.sha256 = sha256_file(&path).unwrap();
        assert!(verify_asset_file(&path, &item).is_ok());
        item.sha256 = "0".repeat(64);
        assert!(verify_asset_file(&path, &item).is_err());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn atomic_manifest_round_trip_preserves_active_pointer() {
        let root = std::env::temp_dir().join(format!("nd-engine-manifest-{}", std::process::id()));
        let path = root.join("manifest.json");
        let mut manifest = ActiveManifest {
            schema_version: MANIFEST_SCHEMA,
            ..ActiveManifest::default()
        };
        manifest.active.insert(
            "yt-dlp".into(),
            ActiveEngine {
                version: "2026.1".into(),
                executable: "yt-dlp/2026.1/yt-dlp".into(),
            },
        );
        write_atomic(&path, &manifest).unwrap();
        assert_eq!(load_active(&root).active["yt-dlp"].version, "2026.1");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn active_jobs_defer_installation() {
        let request = InstallRequest {
            asset: asset(),
            staged_path: "/missing/staged-engine".into(),
            active_jobs: 1,
        };
        assert!(install_from_staging(request)
            .unwrap_err()
            .contains("deferred"));
    }

    #[test]
    #[ignore = "requires two authentic local yt-dlp executables and mutates a temporary managed runtime"]
    fn installs_real_ytdlp_reports_version_and_rolls_back() {
        let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/yt-dlp");
        let alternate = PathBuf::from("/opt/homebrew/bin/yt-dlp");
        if !bundled.is_file() || !alternate.is_file() {
            panic!("authentic local yt-dlp binaries are required for this acceptance test");
        }
        let version = |path: &Path| {
            let output = std::process::Command::new(path)
                .arg("--version")
                .output()
                .expect("yt-dlp must start");
            assert!(output.status.success());
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        };
        let old_version = version(&bundled);
        let new_version = version(&alternate);
        assert_ne!(old_version, new_version, "acceptance test needs two real versions");
        let root = std::env::temp_dir().join(format!("nd-engine-real-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        std::env::set_var("ND_MEDIA_ENGINES_DIR", &root);
        let make_asset = |path: &Path, version: &str| EngineAsset {
            engine: "yt-dlp".into(),
            package_id: "yt-dlp".into(),
            version: version.into(),
            channel: "stable".into(),
            platform: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
            download_url: "https://updates.example.invalid/yt-dlp".into(),
            sha256: sha256_file(path).unwrap(),
            size_bytes: fs::metadata(path).unwrap().len(),
            publisher: "ND local acceptance".into(),
            min_app_version: "0.9.0".into(),
            companions: Vec::new(),
            license: "Unlicense".into(),
            file_name: "yt-dlp".into(),
        };
        let old_asset = make_asset(&bundled, &old_version);
        let new_asset = make_asset(&alternate, &new_version);
        install_from_staging(InstallRequest { asset: old_asset.clone(), staged_path: bundled.to_string_lossy().into_owned(), active_jobs: 0 }).unwrap();
        let first = inventory().into_iter().find(|item| item.key == "yt-dlp").unwrap();
        assert_eq!(first.installed_version.as_deref(), Some(old_version.as_str()));
        install_from_staging(InstallRequest { asset: new_asset, staged_path: alternate.to_string_lossy().into_owned(), active_jobs: 0 }).unwrap();
        let second = inventory().into_iter().find(|item| item.key == "yt-dlp").unwrap();
        assert_eq!(second.installed_version.as_deref(), Some(new_version.as_str()));
        assert!(second.rollback_available);
        let restored = rollback("yt-dlp").unwrap();
        assert_eq!(restored.installed_version.as_deref(), Some(old_version.as_str()));
        std::env::remove_var("ND_MEDIA_ENGINES_DIR");
        let _ = fs::remove_dir_all(root);
    }
}
