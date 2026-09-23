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

// 브라우저 계산 엔진(TypeScript, src/engine/)이 받는 데이터 파일. 2026-09-23부터 사이트는 파이썬(Pyodide)
// 엔진을 쓰지 않으므로 .py 파일은 싣지 않는다 — 파이썬 엔진은 MCP 서버·CLI·회귀 검사용으로 저장소에 남아 있다.
const runtimeFiles = [
  'data/parsed_nikke.json',
  'data/parsed_skills.json',
  'data/char_defaults.json',
  'data/weapon_delays.json',
  'data/weapon_mechanics.json',
  'data/burst_gauge.json',
  'data/base_stat_tables/affinity.json',
  'data/base_stat_tables/collection.json',
  'data/base_stat_tables/console.json',
  'data/base_stat_tables/cube.json',
  'data/base_stat_tables/equipment_skills.json',
  'data/base_stat_tables/equipment_stats.json',
  'data/base_stat_tables/level_beyond.json',
  'data/base_stat_tables/level_stats.json',
];


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
// 창작 임시 스킬이 바뀌면 이전 계산 결과 캐시도 무효화한다.
hash.update(readFileSync(join(siteDir, 'src', 'temporary-characters.json')));
for (const relativePath of runtimeFiles) {
  const source = join(repoRoot, relativePath);
  const target = join(runtimeDir, relativePath);
  const content = readFileSync(source);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  hash.update(relativePath);
  hash.update(content);
}

const nikke = readJson(join(repoRoot, 'data', 'parsed_nikke.json'));
const skills = readJson(join(repoRoot, 'data', 'parsed_skills.json'));
// 블라블라링크 응답은 캐릭터를 name_code로 부른다. 사전은 CDN에서 받아 커밋해 둔
// `data/name_codes.json`이 정본이고(`scraper/blabla_ids_fetch.py`), 여기서 뒤집어
// 카탈로그 항목에 붙인다 — 캐릭터 하나에 대한 메타데이터라 카탈로그가 제자리다.
// enikk은 캐릭터를 resource_id로 부른다 — 우리 스크랩 데이터의 `id`와 같은 체계다.
// 영문 표기(`Liter`=리타)로 맞추면 반드시 틀리므로 이 번호로 잇는다.
const scrapedRaw = readJson(join(repoRoot, 'scraper', 'nikke_scraped.json'));
const previewRaw = readJson(join(repoRoot, 'scraper', 'preview_skills.json'));
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

/**
 * 「1버 아군이 없으면 내가 1버」 — 라피 : 레드 후드처럼 **다른 사람이 없을 때만** 그
 * 단계에 서는 니케. 엔진은 `burst_stage_override:N`(조건 `no_burstN_ally`)로 이미
 * 그렇게 굴리는데, 화면의 버스트 순서 표는 카탈로그의 고정 단계만 보고 있어 그 사람을
 * 1버 칸에 세울 수가 없었다. 데이터에서 뽑아 화면에도 알려 준다.
 */
const altBurstStageOf = (name) => {
  for (const effect of skills[name] ?? []) {
    const stat = String(effect?.stat ?? '');
    const match = /^burst_stage_override:([123])$/.exec(stat);
    if (!match) continue;
    const conditions = effect?.trigger?.condition ?? [];
    if (conditions.includes(`no_burst${match[1]}_ally`)) return match[1];
  }
  return null;
};

const catalog = names.map((name) => {
  const meta = nikke[name];
  const sourceImage = imageIndex.get(normalizeImageName(name));
  let image = null;
  if (sourceImage) {
    // 정렬 순번 URL은 신캐 추가 시 다른 니케의 캐시를 재사용한다.
    // 이름과 이미지 바이트에 묶어 순서 변경은 안정적이고 이미지 교체는 새 URL이 되게 한다.
    const imageHash = createHash('sha256').update(name).update('\0')
      .update(readFileSync(join(repoRoot, 'image', sourceImage))).digest('hex').slice(0, 20);
    const outputName = `${imageHash}.webp`;
    copyFileSync(join(repoRoot, 'image', sourceImage), join(characterDir, outputName));
    image = `characters/${outputName}`;
  }
  return {
    name,
    info: (() => {
      const raw = scrapedRaw[name] ?? previewRaw[name];
      if (!raw) return undefined;
      return {
        squad: raw['스쿼드명'], weapon: raw['무기상세']?.['무기스킬'],
        favorite: raw['애장품'] ? { name: raw['애장품']['아이템명'],
          skills: (raw['애장품']['단계별'] ?? []).map(skill => ({
            stage: skill['단계'], key: String(skill['교체슬롯']), name: skill['스킬명'],
            template: skill.template ?? '', values: skill.values ?? {},
          })),
        } : undefined,
        skills: Object.entries(raw['스킬'] ?? {}).map(([name, skill], index) => ({
          key: String(index + 1), name, template: skill.template ?? '',
          values: skill.values ?? {}, cooldown: skill['쿨타임'],
        })),
      };
    })(),
    burstStage: String(meta.burst_stage ?? ''),
    // 그 단계의 다른 아군이 없을 때만 설 수 있는 자리. 없으면 null.
    altBurstStage: altBurstStageOf(name),
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

// 설정 메타데이터는 계산 엔진(src/engine/)에서 뽑는다 — TypeScript라 tsx 로더로 돌린다.
const settings = execFileSync(
  process.execPath,
  ['--import', import.meta.resolve('tsx'), join(scriptDir, 'export-settings.ts')],
  { cwd: siteDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
hash.update('settings.json');
hash.update(settings);
const manifest = {
  version: hash.digest('hex').slice(0, 16),
  files: [...runtimeFiles],
};

writeFileSync(join(runtimeDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(publicDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
// 영어·일본어·중국어 번체 이름표(`scraper/cdn_locale.py`가 받아 둔 것). 한국어로
// 보는 사람은 받지 않으므로 번들이 아니라 파일로 둔다.
writeFileSync(
  join(publicDir, 'locale-text.json'),
  readFileSync(join(repoRoot, 'data', 'locale_text.json'), 'utf8'),
);
writeFileSync(join(publicDir, 'settings.json'), settings);


const withNameCode = catalog.filter((entry) => entry.nameCode !== null).length;
const withAlias = catalog.filter((entry) => entry.aliases.length > 0).length;
// 별칭 표의 이름이 카탈로그에 없으면 조용히 사라진다 — 오타를 여기서 잡는다.
const strayAliases = [...aliasesByCharacter.keys()].filter((name) => !nikke[name]);
if (strayAliases.length > 0) {
  console.warn(`별칭 표에 없는 캐릭터가 있습니다: ${strayAliases.join(', ')}`);
}
console.log(`runtime ${manifest.files.length} files · catalog ${catalog.length} characters (name_code ${withNameCode}, 별칭 ${withAlias}) · settings exported · version ${manifest.version}`);

// Remove retired external-execution artifacts from reused build directories.
for(const name of readdirSync(publicDir))if(/^external-engine-[a-f0-9]+\.zip$/.test(name)||name==='overload-solver.mjs')rmSync(join(publicDir,name));
for(const name of ['overload-solver.txt','overload-version.json'])rmSync(join(siteDir,'src/generated',name),{force:true});
