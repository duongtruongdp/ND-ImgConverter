# Changelog

All notable changes and feature releases for **ND Image Converter** are documented in this file.

---

## [v0.6.1] - 2026-08-19

### Fixed
* Automated Update Checker: Corrected the GitHub repository URL slug (duongtruongdp/ND-ImgConverter) to resolve 404 Not Found API responses.
* Dynamic Release Detection: Replaced hardcoded version strings with runtime getVersion() resolution and implemented a robust SemVer numeric comparison to catch both stable and pre-release updates.
* External Redirection: Fixed cross-platform release page navigation using browser fallback mechanisms.

## [v0.6.0] - 2026-08-17 🚀

### ⚡ Added

* High-Performance Watermark Engine:
* Typography & Signature Mode: Sub-pixel text rendering powered by ab_glyph with dynamic font scaling and opacity controls.
* Custom Logo Overlays: Alpha-blended graphic stamping supporting transparent PNG and WebP assets.
* 9-Anchor Positioning Matrix: Precision placement grid (Top, Center, Bottom / Left, Center, Right) with proportional margin offsets.
* Interactive Live Canvas Preview: Real-time visual feedback for typography size, opacity, and positioning before batch processing.
* Zero-Overhead EXIF & Metadata Stripper: One-click toggle to remove GPS location tags, camera metadata, and embedded preview thumbnails for privacy protection and smaller file sizes.
* Official Linux Packaging Pipeline: Added automated GitHub Actions build support for Linux distributions via .deb and standalone .AppImage packages.

### Changed
* Typography Alignment: Enhanced text metric calculations using actual glyph advances instead of character estimates for precise right-aligned and bottom-aligned placements.
* Build Optimization: Configured Rust compiler dev profile optimizations (opt-level = 2) for faster 8K multi-threaded processing.

### ⚡ What's New

* **🤖 Watch Folder Automation**
  * Auto-detect and batch convert images instantly when dropped into an incoming directory.
  * Designed for tethered photography, SD card ingestion, and content creation pipelines.

* **🎨 Little-CMS2 Studio Color Management**
  * Industry-standard ICC color profiling to ensure accurate conversions across **sRGB**, **Display P3**, and **Adobe RGB**.
  * Eliminates color shifts and washed-out contrast when exporting camera RAW, TIFF, and HEIC files.

* **📊 Real-time Image Quality Analyzer**
  * Live file size estimation and compression savings metrics before running exports.
  * Smart quality tier indicators to help you balance visual fidelity and web bandwidth.

* **🔍 Pro Inspection & Comparison Modal**
  * Synchronized **1:1 pixel inspection** with smooth Pan & Zoom controls.
  * Interactive Before/After slider to evaluate sharpness, noise, and compression artifacts at a glance.

* **🛡️ Privacy-First Metadata Stripper**
  * One-click location privacy: strips sensitive GPS coordinates while preserving critical EXIF data (ISO, aperture, shutter speed, and copyright).

---

## [v0.3.0] - Foundation & Engine Speedup ⚡

* Multi-threaded batch conversion engine powered by Rust and Rayon.
* Support for 50+ input formats, including native Camera RAW, SVG, AVIF, and WebP.
* Split-screen Before/After comparison view.
* Customizable export presets for social media, web optimization, and archiving.

---

## [v0.1.0] - Initial Release 🎉

* Fast, native, and private image converter for macOS & Windows.
* Zero cloud uploads — 100% offline, secure local processing.
