# ND Image Converter

**Blazing-fast, privacy-first, offline batch image converter & optimizer for desktop.**

![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Built With](https://img.shields.io/badge/built%20with-Tauri%202%20%7C%20Rust%20%7C%20React-orange.svg)

---

## ⚡ Overview

**ND Image Converter** is a modern, lightweight desktop utility designed for creators, photographers, and developers who need high-throughput image conversion without sacrificing privacy or speed.

Built with **Tauri 2**, **React**, and a multi-threaded **Rust processing engine**, it runs 100% offline directly on your machine.

---

## ✨ Features (v0.1)

- 🔒 **100% Offline & Private:** No cloud uploads, no telemetry, no tracking.
- ⚡ **Multi-threaded Engine:** Powered by Rust and `rayon` for fast batch processing on multi-core CPUs (Apple Silicon & Intel/AMD).
- 🖼 **Formats Supported:** Fast decoding and encoding between **JPG/JPEG**, **PNG**, and **WebP**.
- 🎯 **Smart Resize Options:**
  - Original dimensions
  - Fixed Width (with aspect-ratio preservation)
  - Percentage Scaling
- 🎚 **Precision Quality Control:** Fine-tune compression ratio for JPEG and WebP.
- 🚀 **Fast Async Metadata & Thumbnails:** Instant thumbnail previews even when dropping dozens of 4K images.
- 📂 **Flexible Output Management:** Save next to source files or select a custom output directory.
- 🖥 **Native macOS Experience:** Frameless window design with system traffic lights, drag-and-drop, and Finder integration.

---

## 🛠 Tech Stack

- **Desktop Framework:** [Tauri 2](https://tauri.app/)
- **Core Processing Engine:** [Rust](https://www.rust-lang.org/) (`image`, `rayon`, `webp`, `tokio`)
- **Frontend Framework:** [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/)
- **State Management:** [Zustand](https://github.com/pmndrs/zustand)
- **Icons:** [Lucide React](https://lucide.dev/)

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:

1. **Node.js:** v18.0 or newer
2. **Rust & Cargo:** Stable toolchain via `rustup`
3. **Xcode Command Line Tools** (for macOS):
   ```bash
   xcode-select --install