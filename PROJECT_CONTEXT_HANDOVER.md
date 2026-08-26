# Project Context Handover — ND Image Converter

**Snapshot:** v0.6.1 · Tauri 2 · React 19 · TypeScript · Rust 2021  
**Mục tiêu:** đủ ngữ cảnh kỹ thuật để tiếp tục phát triển trong phiên chat mới.

## 1. Tổng quan dự án & mục tiêu cốt lõi

ND Image Converter là ứng dụng desktop chuyển đổi và tối ưu ảnh hàng loạt, ưu tiên tốc độ, quyền riêng tư và xử lý offline. Người dùng chính: nhiếp ảnh gia, creator, developer và người cần đổi định dạng/resize nhiều ảnh, gồm camera RAW và ảnh iPhone.

Luồng: React nhận file qua native dialog (`open`) hoặc kéo-thả Tauri Webview; `scan_dropped_paths` quét thư mục đệ quy; `fetch_batch_metadata` lấy kích thước, thumbnail WebP và EXIF. Frontend gọi Rust bằng `invoke`, lưu state ở Zustand và nhận `conversion-progress`. Rust đọc file local, decode → watermark → resize → color transform → encode. Batch chạy song song bằng Rayon; không có server/cloud/telemetry.

## 2. Tech stack & thư viện

- Desktop: Tauri 2, Rust 2021; frontend trong WebView.
- Frontend: React 19, TypeScript 5.8, Vite 7, Tailwind CSS 4, Zustand 5, `lucide-react`, `clsx`, `tailwind-merge`.
- Tauri plugins: dialog, fs, opener, shell.
- Image: `image` 0.25 (JPEG/PNG/WebP/BMP/ICO/TIFF/TGA/GIF/EXR/PNM/QOI/AVIF), `webp`, `resvg`/`usvg` (SVG), `rawloader` (RAW), `lcms2` (ICC/color), `imageproc` + `ab_glyph`/`rusttype` (watermark), `base64`.
- Metadata/automation: `kamadak-exif`, `notify`, `notify-debouncer-mini`, `rayon`.
- Không dùng trong code hiện tại: `heic2any`, `exif-js`, `libvips`, Web Workers, Canvas hay WebAssembly. Pipeline ảnh nằm ở Rust/native.

## 3. Kiến trúc & luồng xử lý hình ảnh

Thành phần chính: `src/App.tsx` điều phối UI/drag/drop/batch/progress; `src/stores/fileStore.ts` quản lý `ImageItem`; `src/stores/settingsStore.ts` persist settings với key `nd-image-converter-settings` và các preset; `src/types/conversion.ts` định nghĩa format/settings; `src-tauri/src/lib.rs` chứa commands, cancellation/watcher và Rayon batch; `src-tauri/src/engine/pipeline.rs` chứa `decode_any_image`, `process_single_image`, `get_image_metadata`, `estimate_single_file_size`; các module còn lại là `resize.rs`, `color.rs`, `metadata.rs`, `watcher.rs`, `watermark.rs`.

### Input/output

Input được nhận diện bằng lowercase extension: raster phổ biến, SVG, RAW (`arw/cr2/cr3/crw/dng/nef/orf/pef/raf/rw2/sr2/srf`), PSD/EXR, HEIC/HEIF. UI khai báo 19 output: WebP, AVIF, JPEG, PNG, GIF, TIFF, EXR, PSD, TGA, BMP, PDF, ICO, ICNS, DDS, KTX, ASTC, PVR, JP2, PBM. Output dùng basename trong `output_directory`, hoặc thư mục input; extension map trong `process_single_image`. Chưa có collision policy nên có thể overwrite.

### Pipeline

`decode_any_image` dùng macOS `sips` → PNG tạm cho HEIC/HEIF; fallback đọc trực tiếp/embedded JPEG. SVG parse bằng `usvg`, render bằng `resvg`. RAW ưu tiên embedded JPEG lớn nhất, rồi `rawloader` + `demosaic_bayer_to_rgb` (hiện chưa phải demosaic màu đầy đủ). Raster còn lại dùng `image::ImageReader`.

Sau decode: `apply_watermark` nếu enabled → `apply_resize` → `apply_color_transform` → encode. Resize hỗ trợ `Original`, `Width`, `Percentage`, dùng Lanczos3 và giữ tỉ lệ mặc định. Little-CMS hỗ trợ `Original`, sRGB, Display P3, Adobe RGB, nhưng frontend hiện luôn gửi `colorSpace: 'srgb'` và source ICC được truyền `None` nên mặc định sRGB. JPEG/WebP dùng quality; PNG/BMP/ICO/TIFF/TGA có encoder riêng; nhánh còn lại dùng `DynamicImage::save`.

`extract_exif_info` chỉ đọc Model/Lens/ISO/FNumber/ExposureTime/GPS để hiển thị. Re-encode không truyền raw EXIF nên thường không giữ metadata, nhưng policy chọn từng trường chưa được triển khai. `calculate_quality_estimate` chỉ ước tính theo pixel/quality, không encode thử.

### Async, batch, memory

`fetch_batch_metadata` và `start_batch_conversion` dùng Rayon `into_par_iter`; mỗi file decode/encode độc lập, emit event sau từng file. `cancel_conversion` đặt `AtomicBool`: chỉ cooperative, không interrupt file đang xử lý; file bỏ qua không emit progress. Thumbnail là WebP 96×96 base64 trong memory/UI. Chưa có bounded queue, memory budget, streaming decode hoặc lazy thumbnail; batch RAW/ảnh lớn có thể dùng nhiều RAM.

## 4. Trạng thái tính năng v0.6.1

### Đã có

- Batch local/offline, native dialog, kéo-thả file/thư mục đệ quy, chống trùng path.
- Thumbnail, kích thước, resolution, trạng thái queued/processing/completed/failed và output/reveal Finder/Explorer/Linux.
- 19 output format trong UI; preset Web Opt, HD Share, PNG Max.
- Resize original/width/percentage, aspect-ratio lock; quality và ước tính size/savings.
- Before/after comparison modal với pan/zoom.
- Watch Folder: incoming/processed folder, debounce 1.5 giây, tối đa 50 log, event `folder-automation-event`; watcher `NonRecursive`.
- Watermark text/logo: 9 vị trí, opacity, scale, PNG/WebP logo, Roboto-Bold nhúng.
- Settings persist; Cmd/Ctrl+O, Cmd/Ctrl+Enter, Cmd/Ctrl+Backspace; native window dragging.

### Thay đổi v0.6.1

Version đồng bộ trong package/Cargo/Tauri config và UI. Auto-update checker sửa repo slug thành `duongtruongdp/ND-ImgConverter`, gọi releases endpoint động, lấy runtime version bằng `getVersion()` và chỉ báo khi tag mới hơn bằng numeric SemVer-like. Watermark, EXIF UI và Linux pipeline được bổ sung ở nền v0.6 (commit `eb9d0ae`); v0.6.1 chủ yếu ổn định/sửa updater.

### UI/UX

Dark minimalist, desktop-first, toàn màn hình: header branding/version, tab `Batch Convert`/`Watch Folder`, preset và quick actions; dropzone hoặc danh sách file; settings format/quality/resize/output; popover Watermark/Metadata; progress/status, comparison và reveal.

## 5. Known issues & technical debt

- **EXIF stripper chưa nối pipeline:** UI có `stripMetadata`, frontend gửi `strip_metadata`, model có field, nhưng `process_single_image` không dùng field. `optimizer.rs::post_process_optimization` không được gọi và hiện cũng không thực sự strip/re-encode. Cần triển khai policy và test GPS/EXIF/XMP/ICC trước khi gọi đây là privacy feature hoàn chỉnh.
- `optimizer.rs` là code chưa dùng; metadata policy trong type Rust chưa được nối vào UI.
- Color-space selector chưa thành luồng thực tế; embedded ICC chưa được đọc/truyền.
- RAW fallback chưa demosaic CFA đúng màu; HEIC phụ thuộc `sips` trên macOS và fallback khác nền tảng không chắc chắn. Crate `heic` chưa dùng trực tiếp.
- Một số output (`ICNS`, DDS, KTX, ASTC, PVR, JP2, PSD, PDF) chưa có encoder chuyên biệt; nhánh `save()` có thể fail tùy codec/feature. Cần kiểm chứng end-to-end.
- Output basename có thể overwrite; cancellation không hoàn chỉnh; watcher không recursive, không persist, không chống xử lý output/retry.
- Watch Folder không gửi watermark/strip metadata; `read_image_as_data_url` MIME mapping thiếu nhiều extension.
- `format_name` chỉ từ extension và color profile trả cố định `sRGB / Rec.709`, không phản ánh container/ICC thật.
- Chưa thấy test suite cho codec, metadata, collision, memory hoặc cross-platform. README badge/link vẫn v0.6.0 dù code là v0.6.1.

## 6. Roadmap từ v0.7

1. **v0.7 Correctness/privacy:** triển khai `strip-all`/remove-location/keep ICC/copyright thật, nối cùng options cho Watch Folder, test metadata và cập nhật README/release.
2. **v0.7.x Format parity:** xác định codec từng output, đánh dấu format chưa hỗ trợ, collision-safe names, atomic temp output + rename, lỗi theo file.
3. **v0.8 RAW/color:** demosaic RAW màu đúng, đọc orientation/ICC thật, color-space selector, HEIC cross-platform đáng tin cậy.
4. **v0.8.x Performance:** bounded Rayon pool/queue, memory limit, streaming/chunk, lazy thumbnail, cancellation token từng file và progress cancelled.
5. **v0.9 Automation:** recursive watch tùy chọn, ignore output folder, file-stability checks, persist profiles/config, retry và export log.
6. **v1.0 Stable:** parity macOS/Windows/Linux, signed installers, integration tests trên fixture corpus, benchmark, accessibility/UI polish, updater channels.

### Điểm bắt đầu cho chat mới

Đọc trước `src-tauri/src/engine/pipeline.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/models/conversion.rs`, `src/stores/settingsStore.ts`, `src/App.tsx`. Ưu tiên correctness metadata/codec trước tính năng mới. Giữ JSON camelCase của `ConversionOptions` và event names `conversion-progress`/`folder-automation-event`.
