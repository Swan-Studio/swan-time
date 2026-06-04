// Pure helpers for the updater — no Electron imports, so these are unit-testable
// under plain Node (see tests/updaterCore.test.ts).
import fs from 'node:fs';
import crypto from 'node:crypto';

export interface UpdateAsset {
  url: string; // file name as listed in latest-mac.yml, e.g. "Swan-Time-1.0.7-universal.dmg"
  sha512?: string; // base64
}

export function pickDmgAsset(files: UpdateAsset[]): UpdateAsset | undefined {
  return files.find(f => f.url.toLowerCase().endsWith('.dmg'));
}

export function buildDownloadUrl(owner: string, repo: string, version: string, fileName: string): string {
  return `https://github.com/${owner}/${repo}/releases/download/v${version}/${encodeURIComponent(fileName)}`;
}

export function sha512Of(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject);
  });
}
