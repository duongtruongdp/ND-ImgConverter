# ND Image Converter

**Blazing-fast, privacy-first, offline batch image converter & optimizer for desktop.**

![Version](https://img.shields.io/badge/version-0.6.3-blue.svg)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Built With](https://img.shields.io/badge/built%20with-Tauri%202%20%7C%20Rust%20%7C%20React-orange.svg)

---

<p align="center">
  <img src="app-icon.png" alt="ND Image Converter" width="28%">
</p>

<p align="center">
  <a href="https://github.com/duongtruongdp/ND-ImgConverter/releases/latest">
    <img src="https://img.shields.io/badge/Download-Latest%20Release%20(v0.6.3)-2563eb?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release" />
  </a>
</p>

---

## ⚡ Quick Download & Install

No terminal or programming tools required. Simply download the pre-built installer for your platform:

| Platform | Installer | Architecture | Download Link |
| :--- | :--- | :--- | :--- |
| **macOS** | `.dmg` | Apple Silicon (M1/M2/M3/M4) & Intel | [Download .dmg](https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.6.3/ND.Image.Converter_0.6.3_universal.dmg) |
| **Windows** | `.exe` | x64 (64-bit) | [Download .exe](https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.6.3/ND.Image.Converter_0.6.3_x64-setup.exe) |
| **Linux** | `.deb` | Ubuntu, Debian, Linux Mint | [Download .deb](https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.6.3/ND.Image.Converter_0.6.3_amd64.deb) |

### First-Time Launch Instructions

* **macOS (Gatekeeper bypass):**
  * Drag `ND Image Converter` into your `/Applications` folder.
  * If macOS says *"The application can't be opened"*, open **Terminal** and run:
    ```bash
    sudo xattr -cr "/Applications/ND Image Converter.app"
    ```
  * *Alternative:* Right-click the app in Finder $\rightarrow$ select **Open** $\rightarrow$ click **Open Anyway**.
* **Windows (SmartScreen warning):**
  * When *"Windows protected your PC"* appears, click **More info** $\rightarrow$ **Run anyway** (this appears only because open-source projects lack paid $400/yr certificate signatures).

---

## 🌟 Overview

**ND Image Converter** is a high-throughput desktop utility designed for photographers, creators, and developers who need instant image format conversions without cloud uploads or privacy compromises.

Built with **Tauri 2**, **React**, and a multi-threaded **Rust processing engine**, all processing happens 100% locally on your hardware.

---

## ✨ Key Features

### Image conversion and optimization

- 🔒 **Privacy-first offline processing:** Files never leave the computer; no cloud upload, telemetry, or tracking.
- ⚡ **Fast native engine:** Rust-based processing with `rayon` parallelism for responsive batch conversion.
- 🖼 **Broad format support:** Convert common formats such as JPEG, PNG, WebP, AVIF, BMP, ICO, TIFF, TGA, GIF, EXR, and more.
- 📷 **Camera RAW and DNG support:** Decode CR2, CR3, DNG, ARW, NEF, ORF, RAF, and other RAW formats through native demosaicing and embedded-preview handling.
- 📱 **HEIC/HEIF support:** Import and convert modern phone-camera images locally.
- 🎯 **Flexible resizing:** Preserve original dimensions, resize by target width with aspect-ratio preservation, or scale by percentage.
- 🎚 **Quality and size estimation:** Adjust output quality and preview estimated output size before processing.
- 🎨 **Color management:** Optional ICC color transformations using LittleCMS 2, including sRGB, Display P3, Adobe RGB, and Rec.709 workflows.
- 🛡 **Metadata privacy controls:** Strip EXIF metadata, GPS coordinates, thumbnails, and other embedded metadata during export.
- 🖋 **Watermark engine:** Add text or logo watermarks with configurable position, scale, opacity, and automatic image scaling.
- 👁 **Before/after inspection:** Compare source and converted results with an interactive split-view preview.

### Video tools

- 🎞 **Video to GIF:** Convert H.264/H.265 MP4, MOV, MKV, WebM, AVI, and M4V videos into GIF locally.
- ✂️ **Editor-style trim timeline:** Set in/out points by dragging timeline handles, use the integrated playback controls, or edit exact time values.
- 🎛 **GIF export controls:** Configure output width, FPS, and quality with palette generation for better color results.
- 🔁 **Video format converter:** Convert between MP4, MOV, MKV, and WebM containers with selectable H.264, H.265, VP8, VP9, and AV1 codecs.
- 🔊 **Audio preservation:** Choose whether to retain the source audio track during video conversion.
- 📦 **Bundled FFmpeg runtime:** Release builds include the required FFmpeg and FFprobe runtime files for offline video processing.
- 🖱 **Native drag and drop:** Drop image, folder, or video files directly into the relevant workspace.

### Workflow and desktop experience

- 📂 **Batch and recursive folder processing:** Add multiple files or nested directories and process them in one operation.
- 👀 **Watch folder automation:** Monitor an input directory and automatically convert new files as they arrive.
- 📁 **Native output-folder selection:** Choose an output directory through the operating system picker; defaults to the input folder.
- 🔔 **GitHub release update checker:** Detect newer versions and open the official release download page.
- 🖥 **Cross-platform desktop app:** Built with Tauri for macOS, Windows, and Linux with a lightweight native shell.
- 🌙 **Dark, compact UI:** Consistent controls, keyboard-friendly workflows, progress feedback, and conversion status reporting.

---

## 🛠 Tech Stack

* **Desktop Framework:** [Tauri 2](https://tauri.app/)
* **Core Processing Engine:** [Rust](https://www.rust-lang.org/) (`image`, `rayon`, `webp`, `tokio`, `lcms2`)
* **Frontend:** [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
* **Styling:** [Tailwind CSS](https://tailwindcss.com/)
* **State Management:** [Zustand](https://github.com/pmndrs/zustand)
* **Icons:** [Lucide React](https://lucide.dev/)

---

## 👨‍💻 Development & Building from Source

If you want to contribute or build the application from source code:

### Prerequisites

* [Node.js](https://nodejs.org/) (v18.0 or newer)
* [Rust & Cargo](https://rustup.rs/) (stable toolchain)
* **macOS:** Xcode Command Line Tools (`xcode-select --install`)
* **Windows:** Visual Studio C++ Build Tools (with *Desktop development with C++*)

### Local Setup

### 1. Clone repository
```
git clone [https://github.com/duongtruongdp/ND-ImgConverter.git](https://github.com/duongtruongdp/ND-ImgConverter.git)
cd ND-ImgConverter
```

### 2. Install dependencies
```
npm install
```

### 3. Start development environment
```
npm run tauri dev
```

### 4. Packaging production release
```
npm run tauri build
```
The output installation files will be generated in:
- macOS: src-tauri/target/release/bundle/dmg/
- Windows: src-tauri/target/release/bundle/nsis/


## 🛠️ Troubleshooting

### Q&A

**Question**: Why does macOS say "The application can't be opened"?
macOS Gatekeeper may block apps downloaded from the internet. Try these fixes:

- Method 1 (Recommended): Open Terminal and run
```
xattr -cr /Applications/ND Image Converter.app
```
- Method 2: Right-click the app -> select "Open" -> click "Open" in the dialog.

- Method 3: Go to System Settings -> Privacy & Security -> scroll down and click "Open Anyway".

**Question**: Why does Windows show "Windows protected your PC"?
This SmartScreen warning appears because ND Image Converter isn't code-signed yet. Code signing certificates cost $400+/year, which isn't feasible for a free project at this stage.

To install safely:

- Click "More info" on the warning dialog
- Click "Run anyway"
ND Image Converter is 100% free with premium features — download from GitHub and verify it runs completely offline.


## 🗺 Roadmap
[x] v0.1: Core Engine, Batch Conversion (JPG/PNG/WebP), Fast Thumbnails, Native Drag & Drop.

[x] v0.2: Split-screen Before/After Image Comparison Slider, Presets Manager, Keyboard Shortcuts.

[x] v0.3: Support 50+ inputs (including HEIC/RAW/SVG) and 19 modern output formats with dark minimalist UI.

[x] v0.4: Live Watch Folder automation, ICC color management, instant output size estimation, and pixel-level comparison inspection.

[x] v0.5: Integrate GitHub auto-update checker, optimize HEIC fast-path decoding, and polish installer branding.

[x] v0.6: Watermark Engine, EXIF Stripper, and Linux Build Pipeline

[ ] v1.0: Stable milestone release with full cross-platform parity.


## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
