// Fetch each benchmark kit at its pinned commit into .kits/<name>.
// Kit code is never committed here (see .gitignore) and its install scripts
// are never run; the harness only imports the kit's TypeScript sources.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { KITS } from './kits/index.js';

const root = join(import.meta.dirname, '..', '.kits');
mkdirSync(root, { recursive: true });

for (const kit of KITS) {
  const dir = join(root, kit.name);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    git('init', '-q');
    // Byte-exact sources: mutations match on LF text.
    git('config', 'core.autocrlf', 'false');
    git('remote', 'add', 'origin', `https://github.com/${kit.repo}.git`);
  }
  git('fetch', '-q', '--depth', '1', 'origin', kit.commit);
  git('checkout', '-q', '--force', 'FETCH_HEAD');
  git('clean', '-qfd');
  console.log(`${kit.name}: ${kit.repo}@${git('rev-parse', 'HEAD').slice(0, 12)}`);
}
