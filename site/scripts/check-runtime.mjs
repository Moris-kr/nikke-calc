import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(siteDir, 'public');
const manifest = JSON.parse(readFileSync(join(publicDir, 'runtime', 'manifest.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(publicDir, 'catalog.json'), 'utf8'));

const problems = [];
if (!/^[a-f0-9]{16}$/.test(manifest.version)) {
  problems.push('runtime version must be a 16-character hex digest');
}
for (const file of manifest.files) {
  const path = join(publicDir, 'runtime', file);
  if (!existsSync(path) || statSync(path).size === 0) {
    problems.push(`missing or empty runtime file: ${file}`);
  }
}
for (const char of catalog) {
  if (char.name.startsWith('test_')) problems.push(`test character leaked into catalog: ${char.name}`);
  if (char.image && !existsSync(join(publicDir, char.image))) {
    problems.push(`missing portrait: ${char.name} -> ${char.image}`);
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`runtime check OK · ${manifest.files.length} files · ${catalog.length} characters`);
}
