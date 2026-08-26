# ND Image Converter

**Blazing-fast, privacy-first, offline batch image converter & optimizer for desktop.**

![Version](https://img.shields.io/badge/version-0.6.2-blue.svg)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Built With](https://img.shields.io/badge/built%20with-Tauri%202%20%7C%20Rust%20%7C%20React-orange.svg)

---

<p align="center">
  <img src="app-icon.png" alt="ND Image Converter" width="28%">
</p>

<p align="center">
  <a href="https://github.com/duongtruongdp/ND-ImgConverter/releases/latest">
    <img src="https://img.shields.io/badge/Download-Latest%20Release%20(v0.6.2)-2563eb?style=for-the-badge&logo=github&logoColor=white" alt="Download Latest Release" />
  </a>
</p>

---

## ⚡ Quick Download & Install

No terminal or programming tools required. Simply download the pre-built installer for your platform:

| Platform | Installer | Architecture | Download Link |
| :--- | :--- | :--- | :--- |
| **macOS** | `.dmg` | Apple Silicon (M1/M2/M3/M4) & Intel | [Download .dmg](https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.6.1/ND.Image.Converter_0.6.1_universal.dmg) |
| **Windows** | `.exe` | x64 (64-bit) | [Download .exe](https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.6.1/ND.Image.Converter_0.6.1_x64-setup.exe) |
| **Linux** | `.deb` | Ubuntu, Debian, Linux Mint | [Download .deb](https://github.com/duongtruongdp/ND-ImgConverter/releases/download/v0.6.1/ND.Image.Converter_0.6.1_amd64.deb) |

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

## ✨ Features (v0.6.0)

- 🔒 **100% Offline & Private:** Zero cloud uploads, no telemetry, no tracking — your files never leave your device.
- ⚡ **High-Throughput Multi-threaded Engine:** Powered by Rust and `rayon` to utilize all CPU cores on both Apple Silicon and Intel/AMD processors.
- 🖼 **Massive Format Support (50+ In / 19 Out):**
  - **Standard Formats:** JPEG, PNG, WebP, AVIF, BMP, ICO, ICNS, TIFF, TGA, GIF, SVG, PSD, EXR, and more.
  - **Camera RAW & DNG:** Native decoding for Canon (.CR2, .CR3), Adobe (.DNG), Sony (.ARW), Nikon (.NEF), and other major camera brands with accurate Bayer demosaicing.
  - **Optimized HEIC/HEIF:** Direct hardware-accelerated decoding pipelines for instant mobile photo conversions.
- 🛡 **Zero-Overhead EXIF & Metadata Stripper:** One-click toggle to strip camera parameters, thumbnails, and GPS location tags for maximum privacy and ultra-compact file sizes.
- 🎨 **Pro Color Management (Little-CMS 2):** Built-in color profile transforms supporting Rec.709, sRGB, Display P3, and Adobe RGB.
- 📊 **Real-time Quality Analyzer:** Dynamic bitrate and target file-size estimation before conversion.
- 🎯 **Flexible Resize Modes:**
  - Original dimensions
  - Target Width (with automatic aspect-ratio lock)
  - Percentage Scaling
- 👁 **Before/After Split Comparison:** Interactive side-by-side visual inspector to preview compression fidelity.
- 🤖 **Automated Watch Folder:** Background directory monitoring that converts new incoming files on the fly.
- 🔔 **In-App Auto-Update Checker:** Alerts you directly when new GitHub releases are available.
- 📂 **Recursive Directory Ingestion:** Drag-and-drop nested folders with one-click "Reveal in Finder / Explorer".

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
