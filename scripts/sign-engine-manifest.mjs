import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const usage = 'Usage: node scripts/sign-engine-manifest.mjs <unsigned.json> <signed.json> --private-key <pem-file> --key-id <stable-key-id>';

export const manifestForSigning = (manifest) => ({
  schemaVersion: manifest.schemaVersion,
  channel: manifest.channel,
  manifestRevision: manifest.manifestRevision,
  publishedAt: manifest.publishedAt,
  expiresAt: manifest.expiresAt,
  generatedAt: manifest.generatedAt,
  publisher: manifest.publisher,
  signature: null,
  assets: manifest.assets,
});

export const canonicalManifestBytes = (manifest) => Buffer.from(JSON.stringify(manifestForSigning(manifest)), 'utf8');

export const signManifest = (manifest, privateKeyPem, keyId) => {
  if (!keyId || /\s/.test(keyId)) throw new Error('key id must be non-empty and contain no whitespace');
  const key = createPrivateKey(privateKeyPem);
  const value = sign(null, canonicalManifestBytes(manifest), key).toString('base64');
  return {
    ...manifest,
    signature: { algorithm: 'ed25519', keyId, value },
  };
};

if (process.argv[1]?.endsWith('sign-engine-manifest.mjs')) {
  const args = process.argv.slice(2);
  const input = args[0];
  const output = args[1];
  const privateKeyIndex = args.indexOf('--private-key');
  const keyIdIndex = args.indexOf('--key-id');
  if (!input || !output || privateKeyIndex < 0 || keyIdIndex < 0 || !args[privateKeyIndex + 1] || !args[keyIdIndex + 1]) throw new Error(usage);

  const manifest = JSON.parse(readFileSync(input, 'utf8'));
  if (manifest.signature && manifest.signature.value) throw new Error('input manifest must not already contain a signature');
  const signed = signManifest(manifest, readFileSync(args[privateKeyIndex + 1], 'utf8'), args[keyIdIndex + 1]);
  writeFileSync(output, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o644 });
  console.log(`Signed ${output} with key id ${args[keyIdIndex + 1]}. Private key was not written or logged.`);
}
