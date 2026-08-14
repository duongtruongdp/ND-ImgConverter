export type OutputFormat = 
  | 'webp' 
  | 'jpeg' 
  | 'png' 
  | 'avif'
  | 'bmp' 
  | 'ico' 
  | 'icns'
  | 'tiff' 
  | 'tga'
  | 'gif'
  | 'exr'
  | 'pbm'
  | 'pdf'
  | 'psd'
  | 'dds'
  | 'jp2'
  | 'ktx'
  | 'pvr'
  | 'astc';

export const ALL_OUTPUT_FORMATS: { label: string; value: OutputFormat; group: string }[] = [
  // Web & Modern
  { label: 'WEBP', value: 'webp', group: 'Modern' },
  { label: 'AVIF', value: 'avif', group: 'Modern' },
  { label: 'JPEG', value: 'jpeg', group: 'Standard' },
  { label: 'PNG', value: 'png', group: 'Standard' },
  { label: 'GIF', value: 'gif', group: 'Standard' },
  // Pro & Graphics
  { label: 'TIFF', value: 'tiff', group: 'Pro Graphics' },
  { label: 'EXR', value: 'exr', group: 'Pro Graphics' },
  { label: 'PSD', value: 'psd', group: 'Pro Graphics' },
  { label: 'TGA', value: 'tga', group: 'Pro Graphics' },
  { label: 'BMP', value: 'bmp', group: 'Standard' },
  { label: 'PDF', value: 'pdf', group: 'Document' },
  // System Icons & Textures
  { label: 'ICO', value: 'ico', group: 'Icons' },
  { label: 'ICNS', value: 'icns', group: 'Icons' },
  { label: 'DDS', value: 'dds', group: 'Game/Texture' },
  { label: 'KTX', value: 'ktx', group: 'Game/Texture' },
  { label: 'ASTC', value: 'astc', group: 'Game/Texture' },
  { label: 'PVR', value: 'pvr', group: 'Game/Texture' },
  { label: 'JP2', value: 'jp2', group: 'Other' },
  { label: 'PBM', value: 'pbm', group: 'Other' },
];

export const SUPPORTED_INPUT_EXTENSIONS = [
  // Input vẫn giữ HEIC/HEIF để người dùng kéo thả ảnh iPhone vào convert sang định dạng khác bình thường
  'jpg', 'jpeg', 'png', 'webp', 'svg', 'bmp', 'ico', 'gif', 'tiff', 'tif', 'tga', 'pnm', 'qoi', 'avif',
  'arw', 'cr2', 'crw', 'dng', 'nef', 'orf', 'pef', 'raf', 'rw2', 'sr2', 'srf', 'psd', 'exr', 'heic', 'heif'
];

export type ResizeMode = 'original' | 'width' | 'percentage';

export interface ConversionSettings {
  format: OutputFormat;
  quality: number;
  resizeMode: ResizeMode;
  targetWidth?: number;
  scalePercentage?: number;
  maintainAspectRatio: boolean;
  outputDirectory: string;
}

export type FileStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ImageItem {
  id: string;
  path: string;
  name: string;
  size: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  outputSize?: number;
  outputPath?: string;
  status: FileStatus;
  errorMessage?: string;
}

export type ColorSpace = 'original' | 'srgb' | 'display-p3' | 'adobe-rgb';

export type MetadataPolicy = 'keep-all' | 'remove-location' | 'strip-all' | 'custom';

export interface MetadataSettings {
  policy: MetadataPolicy;
  keepExif: boolean;
  keepIcc: boolean;
  keepGps: boolean;
  keepXmp: boolean;
  keepCopyright: boolean;
}

export interface ExportProfile {
  id: string;
  name: string;
  description?: string;
  format: OutputFormat;
  quality: number;
  resizeMode: ResizeMode;
  targetWidth?: number;
  targetHeight?: number;
  scalePercentage?: number;
  maintainAspectRatio: boolean;
  colorSpace: ColorSpace;
  metadata: MetadataSettings;
  outputSuffix?: string;
}

export interface WatchFolderConfig {
  id: string;
  enabled: boolean;
  sourcePath: string;
  outputPath: string;
  profileId: string;
}

export interface SizeEstimationPayload {
  originalSize: number;
  estimatedSize: number;
  savingsPercentage: number;
}