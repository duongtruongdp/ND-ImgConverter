export const VIDEO_OUTPUT_FORMATS = ['mp4', 'mov', 'mkv', 'webm'] as const;
export const VIDEO_CODECS = [
  { value: 'h264', label: 'H.264' },
  { value: 'h265', label: 'H.265' },
  { value: 'vp8', label: 'VP8' },
  { value: 'vp9', label: 'VP9' },
  { value: 'av1', label: 'AV1' },
] as const;
export const VIDEO_FPS_OPTIONS = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] as const;

export type VideoOutputFormat = typeof VIDEO_OUTPUT_FORMATS[number];
export type VideoCodec = typeof VIDEO_CODECS[number]['value'];
