import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const sourceRecords = JSON.parse(readFileSync(new URL('./runtime-sources.json', import.meta.url), 'utf8'));
const ENGINE_FILES = [
  ['ffmpeg', 'ffmpeg'], ['ffprobe', 'ffprobe'], ['yt-dlp', 'ytDlp'], ['gallery-dl', 'galleryDl'], ['bgutil-pot', 'bgutilPot'],
];

const targetInfo = (target) => {
  const parts = target.split('-');
  const platform = target.includes('apple-darwin') ? 'macos' : target.includes('windows') ? 'windows' : null;
  const architecture = target.startsWith('aarch64') ? 'arm64' : target.startsWith('x86_64') ? 'x86_64' : null;
  if (!platform || !architecture) throw new Error(`unsupported runtime target: ${target}`);
  return { platform, architecture, source: sourceRecords.targets[target], parts };
};

export const buildUnsignedManifest = ({ artifactDir, target, baseUrl, generatedAt = new Date().toISOString(), minAppVersion = packageVersion }) => {
  if (!/^https:\/\/[^\s/]+/.test(baseUrl)) throw new Error('base URL must be HTTPS and include a host');
  const { platform, architecture, source } = targetInfo(target);
  if (!source) throw new Error(`no approved runtime source record exists for ${target}`);
  const assets = [];
  for (const [engine, sourceKey] of ENGINE_FILES) {
    const sourceRecord = source[sourceKey];
    if (!sourceRecord?.version) throw new Error(`${target} has no approved ${engine} version`);
    const fileName = process.platform === 'win32' && engine !== 'ffmpeg' && engine !== 'ffprobe' ? `${engine}.exe` : `${engine}`;
    const filePath = join(artifactDir, fileName);
    if (!existsSync(filePath)) throw new Error(`approved artifact is missing: ${filePath}`);
    const bytes = readFileSync(filePath);
    const companions = engine === 'ffmpeg' ? ['ffprobe'] : engine === 'ffprobe' ? ['ffmpeg'] : [];
    assets.push({
      engine,
      version: String(sourceRecord.version).replace(/^v/, ''),
      channel: 'stable',
      platform,
      architecture,
      downloadUrl: `${baseUrl.replace(/\/$/, '')}/engines/${engine}/${sourceRecord.version}/${platform}/${architecture}/${fileName}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: statSync(filePath).size,
      publisher: sourceRecord.publisher,
      minAppVersion,
      companions,
      license: sourceRecord.license,
      fileName,
    });
  }
  return { schemaVersion: 1, generatedAt, publisher: 'ND Image Converter release team', signature: null, assets };
};

if (process.argv[1]?.endsWith('prepare-engine-manifest.mjs')) {
  const [artifactDir, output, target, baseUrl] = process.argv.slice(2);
  if (!artifactDir || !output || !target || !baseUrl) throw new Error('Usage: node scripts/prepare-engine-manifest.mjs <artifact-dir> <unsigned.json> <target> <https-base-url>');
  const manifest = buildUnsignedManifest({ artifactDir, target, baseUrl });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  console.log(`Prepared unsigned engine manifest for ${target} with ${manifest.assets.length} approved assets.`);
}
