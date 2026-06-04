import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pickDmgAsset, buildDownloadUrl, sha512Of } from '../electron/updaterCore';

describe('pickDmgAsset', () => {
  it('picks the .dmg entry when zip and dmg are both listed', () => {
    const files = [
      { url: 'Swan-Time-1.0.7-universal-mac.zip', sha512: 'zzz' },
      { url: 'Swan-Time-1.0.7-universal.dmg', sha512: 'ddd' }
    ];
    expect(pickDmgAsset(files)).toEqual({ url: 'Swan-Time-1.0.7-universal.dmg', sha512: 'ddd' });
  });

  it('matches case-insensitively', () => {
    expect(pickDmgAsset([{ url: 'App.DMG' }])).toEqual({ url: 'App.DMG' });
  });

  it('returns undefined when no dmg is listed', () => {
    expect(pickDmgAsset([{ url: 'Swan-Time-1.0.7-universal-mac.zip' }])).toBeUndefined();
  });
});

describe('buildDownloadUrl', () => {
  it('builds the GitHub release asset URL with v-prefixed tag', () => {
    expect(
      buildDownloadUrl('Swan-Studio', 'swan-time', '1.0.7', 'Swan-Time-1.0.7-universal.dmg')
    ).toBe(
      'https://github.com/Swan-Studio/swan-time/releases/download/v1.0.7/Swan-Time-1.0.7-universal.dmg'
    );
  });

  it('URL-encodes unusual file names', () => {
    expect(buildDownloadUrl('o', 'r', '1.0.0', 'a b.dmg')).toBe(
      'https://github.com/o/r/releases/download/v1.0.0/a%20b.dmg'
    );
  });
});

describe('sha512Of', () => {
  it('returns the base64 sha512 of file contents', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'swan-test-'));
    const file = path.join(dir, 'blob.bin');
    writeFileSync(file, 'hello swan');
    const expected = createHash('sha512').update('hello swan').digest('base64');
    await expect(sha512Of(file)).resolves.toBe(expected);
  });

  it('rejects for a missing file', async () => {
    await expect(sha512Of('/nonexistent/nope.bin')).rejects.toThrow();
  });
});
