import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(scriptDir, '..');
const repoRoot = resolve(siteDir, '..');
const publicDir = join(siteDir, 'public');
const runtimeDir = join(publicDir, 'runtime');
const characterDir = join(publicDir, 'characters');

const runtimeFiles = [
  'calculator/__init__.py',
  'calculator/base_stat.py',
  'calculator/buff_manager.py',
  'calculator/damage.py',
  'calculator/sim_result.py',
  'calculator/timeline.py',
  'context/spec.py',
  'data/parsed_nikke.json',
  'data/parsed_skills.json',
  'data/char_defaults.json',
  'data/weapon_delays.json',
  'data/weapon_mechanics.json',
  'data/base_stat_tables/affinity.json',
  'data/base_stat_tables/collection.json',
  'data/base_stat_tables/console.json',
  'data/base_stat_tables/cube.json',
  'data/base_stat_tables/equipment_skills.json',
  'data/base_stat_tables/equipment_stats.json',
  'data/base_stat_tables/level_stats.json',
];

const bridgeTarget = 'bridge.py';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const normalizeImageName = (value) => value
  .replaceAll(' ', '')
  .replaceAll(':', '')
  .replaceAll('_', '')
  .toLocaleLowerCase('ko');

rmSync(runtimeDir, { recursive: true, force: true });
rmSync(characterDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });
mkdirSync(characterDir, { recursive: true });

const hash = createHash('sha256');
for (const relativePath of runtimeFiles) {
  const source = join(repoRoot, relativePath);
  const target = join(runtimeDir, relativePath);
  const content = readFileSync(source);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  hash.update(relativePath);
  hash.update(content);
}

const bridgeSource = join(siteDir, 'pybridge', 'bridge.py');
const bridgeContent = readFileSync(bridgeSource);
copyFileSync(bridgeSource, join(runtimeDir, bridgeTarget));
hash.update(bridgeTarget);
hash.update(bridgeContent);

const nikke = readJson(join(repoRoot, 'data', 'parsed_nikke.json'));
const skills = readJson(join(repoRoot, 'data', 'parsed_skills.json'));
const imageIndex = new Map();
for (const filename of readdirSync(join(repoRoot, 'image'))) {
  if (extname(filename).toLowerCase() !== '.webp') continue;
  const stem = filename.slice(0, -extname(filename).length);
  imageIndex.set(normalizeImageName(stem), filename);
}

const collator = new Intl.Collator('ko');
const names = Object.keys(skills)
  .filter((name) => !name.startsWith('test_') && nikke[name])
  .sort(collator.compare);

const catalog = names.map((name, index) => {
  const meta = nikke[name];
  const sourceImage = imageIndex.get(normalizeImageName(name));
  let image = null;
  if (sourceImage) {
    const outputName = `${String(index + 1).padStart(3, '0')}.webp`;
    copyFileSync(join(repoRoot, 'image', sourceImage), join(characterDir, outputName));
    image = `characters/${outputName}`;
  }
  return {
    name,
    burstStage: String(meta.burst_stage ?? ''),
    elementCode: String(meta.element_code ?? ''),
    weaponType: String(meta.weapon_type ?? ''),
    className: String(meta.class ?? ''),
    manufacturer: String(meta.manufacturer ?? ''),
    preview: Boolean(meta.preview),
    image,
  };
});

const manifest = {
  version: hash.digest('hex').slice(0, 16),
  files: [...runtimeFiles, bridgeTarget],
};

writeFileSync(join(runtimeDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(publicDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);

console.log(`runtime ${manifest.files.length} files · catalog ${catalog.length} characters · version ${manifest.version}`);
