import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { OutputFormat, ResizeMode } from '../types/conversion';
import { VideoCodec, VideoOutputFormat } from '../types/video';

export type WatermarkPosition =
  | 'TopLeft'
  | 'TopCenter'
  | 'TopRight'
  | 'CenterLeft'
  | 'Center'
  | 'CenterRight'
  | 'BottomLeft'
  | 'BottomCenter'
  | 'BottomRight';

export interface WatermarkConfig {
  enabled: boolean;
  isText: boolean;
  textContent: string;
  imagePath: string | null;
  position: WatermarkPosition;
  opacity: number;
  scalePercent: number;
}

export interface Preset {
  id: string;
  name: string;
  format: OutputFormat;
  quality: number;
  resizeMode: ResizeMode;
  targetWidth?: number;
  scalePercentage?: number;
}

export const DEFAULT_PRESETS: Preset[] = [
  { id: 'web-optimized', name: 'Web Opt', format: 'webp', quality: 80, resizeMode: 'original' },
  { id: 'hd-share', name: 'HD Share', format: 'jpeg', quality: 85, resizeMode: 'width', targetWidth: 1920 },
  { id: 'lossless-png', name: 'PNG Max', format: 'png', quality: 100, resizeMode: 'original' },
];

export interface ConversionSettings {
  format: OutputFormat;
  quality: number;
  resizeMode: ResizeMode;
  targetWidth?: number;
  scalePercentage?: number;
  maintainAspectRatio: boolean;
  outputDirectory: string | null;
  colorSpace: string;
  activePresetId: string | null;
  stripMetadata: boolean;
  watermark: WatermarkConfig;
  theme: 'dark' | 'light';
  videoOutputFormat: VideoOutputFormat;
  videoCodec: VideoCodec;
  videoQuality: number;
  videoAudio: boolean;
  videoForceCfr: boolean;
  videoTargetFps: string;
}

export interface SettingsState extends ConversionSettings {
  setFormat: (format: OutputFormat) => void;
  setQuality: (quality: number) => void;
  setResizeMode: (mode: ResizeMode) => void;
  setTargetWidth: (width?: number) => void;
  setScalePercentage: (scale?: number) => void;
  setMaintainAspectRatio: (maintain: boolean) => void;
  setOutputDirectory: (dir: string | null) => void;
  setColorSpace: (cs: string) => void;
  applyPreset: (preset: Preset) => void;
  setStripMetadata: (strip: boolean) => void;
  setWatermark: (watermark: WatermarkConfig) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setVideoProfile: (profile: Partial<Pick<ConversionSettings, 'videoOutputFormat' | 'videoCodec' | 'videoQuality' | 'videoAudio' | 'videoForceCfr' | 'videoTargetFps'>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      format: 'webp',
      quality: 85,
      resizeMode: 'original',
      targetWidth: undefined,
      scalePercentage: undefined,
      maintainAspectRatio: true,
      outputDirectory: null,
      colorSpace: 'srgb',
      activePresetId: null,

      stripMetadata: true,
      watermark: {
        enabled: false,
        isText: true,
        textContent: '© 2026 ND ImgConverter',
        imagePath: null,
        position: 'BottomRight',
        opacity: 0.8,
        scalePercent: 15,
      },
      theme: 'dark',
      videoOutputFormat: 'webm',
      videoCodec: 'vp9',
      videoQuality: 80,
      videoAudio: true,
      videoForceCfr: false,
      videoTargetFps: '30',

      setFormat: (format) => set({ format, activePresetId: null }),
      setQuality: (quality) => set({ quality, activePresetId: null }),
      setResizeMode: (resizeMode) => set({ resizeMode, activePresetId: null }),
      setTargetWidth: (targetWidth) => set({ targetWidth, activePresetId: null }),
      setScalePercentage: (scalePercentage) => set({ scalePercentage, activePresetId: null }),
      setMaintainAspectRatio: (maintainAspectRatio) => set({ maintainAspectRatio }),
      setOutputDirectory: (outputDirectory) => set({ outputDirectory }),
      setColorSpace: (colorSpace) => set({ colorSpace }),
      applyPreset: (preset) =>
        set({
          format: preset.format,
          quality: preset.quality,
          resizeMode: preset.resizeMode,
          targetWidth: preset.targetWidth,
          scalePercentage: preset.scalePercentage,
          activePresetId: preset.id,
        }),

      setStripMetadata: (stripMetadata: boolean) => set({ stripMetadata }),
      setWatermark: (watermark: WatermarkConfig) => set({ watermark }),
      setTheme: (theme) => set({ theme }),
      setVideoProfile: (profile) => set(profile),
    }),
    {
      name: 'nd-image-converter-settings',
    }
  )
);
