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
import { execFileSync } from 'node:child_process';

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
  'calculator/combat_power.py',
  'calculator/customization.py',
  'calculator/damage.py',
  'calculator/sim_result.py',
  'calculator/timeline.py',
  'context/spec.py',
  'context/growth.py',
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
  'data/base_stat_tables/level_beyond.json',
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
// 블라블라링크 응답은 캐릭터를 name_code로 부른다. 사전은 CDN에서 받아 커밋해 둔
// `data/name_codes.json`이 정본이고(`scraper/blabla_ids_fetch.py`), 여기서 뒤집어
// 카탈로그 항목에 붙인다 — 캐릭터 하나에 대한 메타데이터라 카탈로그가 제자리다.
// enikk은 캐릭터를 resource_id로 부른다 — 우리 스크랩 데이터의 `id`와 같은 체계다.
// 영문 표기(`Liter`=리타)로 맞추면 반드시 틀리므로 이 번호로 잇는다.
const scrapedRaw = readJson(join(repoRoot, 'scraper', 'nikke_scraped.json'));
const resourceByCharacter = new Map(
  Object.entries(scrapedRaw)
    .filter(([, value]) => value && typeof value === 'object' && 'id' in value)
    .map(([name, value]) => [name, Number(value.id)]),
);

// 별칭. 정본은 `context/ALIASES.md`의 «별칭 표»이고 유저가 손으로 채운다
// (그 문서 §원칙 — Claude가 임의로 별칭을 짓지 않는다). 검색이 그 표를 그대로 읽게
// 해서, 표를 고치면 사이트도 같이 바뀌게 한다.
//
// 별칭에는 `크메 (메스트와 함께 조합)`처럼 괄호 주석이 붙기도 한다 — 검색어로 쓸 것은
// 괄호 앞부분이다.
const aliasesByCharacter = (() => {
  const text = readFileSync(join(repoRoot, 'context', 'ALIASES.md'), 'utf8');
  const start = text.indexOf('## 별칭 표');
  if (start < 0) return new Map();
  const nextSection = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, nextSection < 0 ? undefined : nextSection);
  const map = new Map();
  for (const line of section.split('\n')) {
    const row = line.match(/^\|([^|]*)\|([^|]*)\|\s*$/);
    if (!row) continue;
    const name = row[1].trim();
    if (!name || name === '정식 명칭' || /^-+$/.test(name)) continue;
    const list = row[2].split(',')
      .map((piece) => piece.split('(')[0].trim())
      .filter(Boolean);
    if (list.length > 0) map.set(name, list);
  }
  return map;
})();

const nameCodeByCharacter = new Map();
for (const [code, character] of Object.entries(readJson(join(repoRoot, 'data', 'name_codes.json')))) {
  if (!nameCodeByCharacter.has(character)) nameCodeByCharacter.set(character, Number(code));
}
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
    nameCode: nameCodeByCharacter.get(name) ?? null,
    resourceId: resourceByCharacter.get(name) ?? null,
    aliases: aliasesByCharacter.get(name) ?? [],
  };
});

const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
const settings = execFileSync(pythonCommand, [join(scriptDir, 'export-settings.py')], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});
hash.update('settings.json');
hash.update(settings);
const manifest = {
  version: hash.digest('hex').slice(0, 16),
  files: [...runtimeFiles, bridgeTarget],
};

writeFileSync(join(runtimeDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(publicDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
writeFileSync(join(publicDir, 'settings.json'), settings);


const withNameCode = catalog.filter((entry) => entry.nameCode !== null).length;
const withAlias = catalog.filter((entry) => entry.aliases.length > 0).length;
// 별칭 표의 이름이 카탈로그에 없으면 조용히 사라진다 — 오타를 여기서 잡는다.
const strayAliases = [...aliasesByCharacter.keys()].filter((name) => !nikke[name]);
if (strayAliases.length > 0) {
  console.warn(`별칭 표에 없는 캐릭터가 있습니다: ${strayAliases.join(', ')}`);
}
console.log(`runtime ${manifest.files.length} files · catalog ${catalog.length} characters (name_code ${withNameCode}, 별칭 ${withAlias}) · settings exported · version ${manifest.version}`);
