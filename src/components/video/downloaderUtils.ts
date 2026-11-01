export const parseMediaUrls = (value: string): string[] => Array.from(new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)));

export const clampDownloaderSetting = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.round(value) : minimum));

export const selectedIndexExpression = (indices: number[]): string => Array.from(new Set(indices.filter((index) => Number.isInteger(index) && index > 0))).sort((left, right) => left - right).join(',');
