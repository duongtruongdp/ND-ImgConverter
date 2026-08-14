import { create } from 'zustand';
import { ConversionSettings, OutputFormat, ResizeMode } from '../types/conversion';

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
  {
    id: 'web-optimized',
    name: 'Web Optimized',
    format: 'webp',
    quality: 80,
    resizeMode: 'width',
    targetWidth: 1920,
  },
  {
    id: 'thumbnails',
    name: 'Thumbnails',
    format: 'webp',
    quality: 75,
    resizeMode: 'width',
    targetWidth: 400,
  },
  {
    id: 'lossless-png',
    name: 'Lossless PNG',
    format: 'png',
    quality: 100,
    resizeMode: 'original',
  },
  {
    id: 'social-jpeg',
    name: 'Social JPEG',
    format: 'jpeg',
    quality: 85,
    resizeMode: 'width',
    targetWidth: 2048,
  },
];

interface SettingsState extends ConversionSettings {
  activePresetId: string | null;
  setFormat: (format: OutputFormat) => void;
  setQuality: (quality: number) => void;
  setResizeMode: (mode: ResizeMode) => void;
  setTargetWidth: (width?: number) => void;
  setScalePercentage: (scale?: number) => void;
  setMaintainAspectRatio: (maintain: boolean) => void;
  setOutputDirectory: (dir: string) => void;
  applyPreset: (preset: Preset) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  format: 'webp',
  quality: 85,
  resizeMode: 'original',
  targetWidth: 1920,
  scalePercentage: 80,
  maintainAspectRatio: true,
  outputDirectory: '',
  activePresetId: null,

  setFormat: (format) => set({ format, activePresetId: null }),
  setQuality: (quality) => set({ quality, activePresetId: null }),
  setResizeMode: (resizeMode) => set({ resizeMode, activePresetId: null }),
  setTargetWidth: (targetWidth) => set({ targetWidth, activePresetId: null }),
  setScalePercentage: (scalePercentage) => set({ scalePercentage, activePresetId: null }),
  setMaintainAspectRatio: (maintainAspectRatio) => set({ maintainAspectRatio }),
  setOutputDirectory: (outputDirectory) => set({ outputDirectory }),

  applyPreset: (preset) =>
    set({
      format: preset.format,
      quality: preset.quality,
      resizeMode: preset.resizeMode,
      targetWidth: preset.targetWidth,
      scalePercentage: preset.scalePercentage,
      activePresetId: preset.id,
    }),
}));