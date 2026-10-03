import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve('apps/api/scripts/backup-local-objects.sh');
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('local object backup script', () => {
  it('creates an archive with a matching checksum', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mahoshojo-object-backup-'));
    temporary.push(root);
    const objects = path.join(root, 'objects');
    const backups = path.join(root, 'backups');
    const objectPath = path.join(objects, 'v1', 'generation', 'output.md');
    const objectDirectory = path.dirname(objectPath);
    execFileSync('mkdir', ['-p', objectDirectory]);
    writeFileSync(objectPath, '# report\n');
    const archive = execFileSync('sh', [script], {
      env: {
        ...process.env,
        LOCAL_OBJECTS_DIR: objects,
        LOCAL_BACKUP_DIR: backups,
        LOCAL_BACKUP_RETENTION_DAYS: '14',
      },
      encoding: 'utf8',
    }).trim();
    const checksum = `${archive}.sha256`;
    expect(readFileSync(checksum, 'utf8')).toContain(path.basename(archive));
    execFileSync('sha256sum', ['-c', checksum], { cwd: backups, stdio: 'pipe' });
  });

  it('rejects nested backup and object directories', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mahoshojo-object-backup-'));
    temporary.push(root);
    expect(() => execFileSync('sh', [script], {
      env: {
        ...process.env,
        LOCAL_OBJECTS_DIR: path.join(root, 'objects'),
        LOCAL_BACKUP_DIR: path.join(root, 'objects', 'backups'),
      },
      encoding: 'utf8',
      stdio: 'pipe',
    })).toThrow();
  });
});
