import { create } from 'zustand';
import { ConversionSettings } from '../types/conversion';

interface SettingsState extends ConversionSettings {
  setFormat: (format: ConversionSettings['format']) => void;
  setQuality: (quality: number) => void;
  setResizeMode: (mode: ConversionSettings['resizeMode']) => void;
  setTargetWidth: (width?: number) => void;
  setScalePercentage: (scale?: number) => void;
  setMaintainAspectRatio: (maintain: boolean) => void;
  setOutputDirectory: (dir: string) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  format: 'webp',
  quality: 85,
  resizeMode: 'original',
  targetWidth: 1920,
  scalePercentage: 80,
  maintainAspectRatio: true,
  outputDirectory: '',
  setFormat: (format) => set({ format }),
  setQuality: (quality) => set({ quality }),
  setResizeMode: (resizeMode) => set({ resizeMode }),
  setTargetWidth: (targetWidth) => set({ targetWidth }),
  setScalePercentage: (scalePercentage) => set({ scalePercentage }),
  setMaintainAspectRatio: (maintainAspectRatio) => set({ maintainAspectRatio }),
  setOutputDirectory: (outputDirectory) => set({ outputDirectory }),
}));