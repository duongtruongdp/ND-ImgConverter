fn main() {
    println!("cargo:rerun-if-changed=../scripts/downloader-versions.json");
    let versions = std::fs::read_to_string("../scripts/downloader-versions.json")
        .expect("downloader version manifest is missing");
    let yt_dlp_version = versions
        .lines()
        .find_map(|line| line.contains("\"ytDlpVersion\"").then(|| line.split('"').nth(3)).flatten()
        )
        .expect("ytDlpVersion is missing");
    println!("cargo:rustc-env=ND_EXPECTED_YTDLP_VERSION={yt_dlp_version}");
    tauri_build::build()
}
