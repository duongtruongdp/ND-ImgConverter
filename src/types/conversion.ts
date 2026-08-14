export type OutputFormat = 'jpeg' | 'png' | 'webp';

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

export interface ImageMetadata {
  path: string;
  width: number;
  height: number;
  size: number;
  thumbnailBase64: string;
}