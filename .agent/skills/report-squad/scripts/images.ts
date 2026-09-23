/**
 * 캐릭터 초상화 → 보고서에 인라인할 data URI.
 *
 * 썸네일(정사각형 자르기 + 축소 + WebP 재인코딩)은 `thumbs.py`(Pillow)에 맡긴다 — 파이썬 보고서 시절과
 * 바이트까지 같은 이미지를 내기 위해서다. 계산 엔진과는 무관한 표시 도우미라 파이썬 엔진을 걷어내도 남는다.
 * 파이썬·Pillow를 못 쓰면(`NIKKE_PYTHON`으로 실행 파일을 지정할 수 있다) **원본 파일을 그대로** 넣고,
 * 잘라 보일 세로 위치(`posY`, %)를 함께 돌려줘 렌더러가 CSS로 자른다. 보고서는 커지지만 그대로 만들어진다.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { ROOT } from './engine_env';

export const IMG_DIR = join(ROOT, 'image');
const IMG_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg']);
const MIME: Record<string, string> = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

export function _norm(s: string): string {
  return s.replace(/ /g, '').replace(/:/g, '').replace(/_/g, '').toLowerCase();
}

function stemOf(fn: string): [string, string] {
  const ext = extname(fn);
  return ext && ext !== fn ? [fn.slice(0, -ext.length), ext] : [fn, ''];
}

let _index: Map<string, string> | null = null;

/** 정규화한 이름 → 경로 (report_html `_img_index`: 같은 이름이면 뒤 파일이 이긴다). */
export function img_index(): Map<string, string> {
  if (_index) return _index;
  _index = new Map();
  if (existsSync(IMG_DIR) && statSync(IMG_DIR).isDirectory()) {
    for (const fn of readdirSync(IMG_DIR)) {
      const [st, ext] = stemOf(fn);
      if (IMG_EXT.has(ext.toLowerCase())) _index.set(_norm(st), join(IMG_DIR, fn));
    }
  }
  return _index;
}

/** optimize_html `_image_data`의 찾기 — 디렉터리 순서로 처음 맞는 파일. */
export function first_image(name: string): string | null {
  const want = _norm(name);
  if (!existsSync(IMG_DIR) || !statSync(IMG_DIR).isDirectory()) return null;
  for (const fn of readdirSync(IMG_DIR)) {
    const [st, ext] = stemOf(fn);
    if (_norm(st) === want && IMG_EXT.has(ext.toLowerCase())) return join(IMG_DIR, fn);
  }
  return null;
}

export interface Portrait {
  /** data URI */
  src: string;
  /** 원본을 그대로 넣었을 때만 — CSS로 자를 세로 위치(%). 썸네일이면 null. */
  posY: number | null;
}

export interface ThumbReq { path: string; size: number; quality: number; always: boolean }

const _cache = new Map<string, Portrait | null>();
const reqKey = (r: ThumbReq): string => `${r.path}\u0000${r.size}\u0000${r.quality}\u0000${r.always}`;

function pythonCandidates(): string[][] {
  const env = process.env['NIKKE_PYTHON'];
  if (env) return [[env]];
  return process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];
}

let _pythonOk: string[] | null | undefined;

function runThumbs(reqs: ThumbReq[]): Array<string | null> | null {
  if (_pythonOk === null) return null;
  const script = join(__dirname, 'thumbs.py');
  const input = JSON.stringify(reqs);
  for (const cmd of (_pythonOk ? [_pythonOk] : pythonCandidates())) {
    const r = spawnSync(cmd[0]!, [...cmd.slice(1), script], { input, maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) {
      try {
        const out = JSON.parse(r.stdout.toString('utf-8'));
        if (Array.isArray(out) && out.length === reqs.length) { _pythonOk = cmd; return out; }
      } catch { /* 다음 후보 */ }
    }
  }
  _pythonOk = null;
  process.stderr.write('  · 썸네일용 파이썬·Pillow를 찾지 못해 원본 초상화를 그대로 넣는다 '
    + '(NIKKE_PYTHON으로 파이썬 실행 파일을 지정할 수 있다)\n');
  return null;
}

/** 이미지 가로·세로 (WebP·PNG·JPEG 머리말). 모르면 null. */
function imageSize(buf: Buffer): [number, number] | null {
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (chunk === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return [1 + (b & 0x3fff), 1 + ((b >>> 14) & 0x3fff)];
    }
  }
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      }
      i += 2 + len;
    }
  }
  return null;
}

function fallback(path: string): Portrait | null {
  let buf: Buffer;
  try { buf = readFileSync(path); } catch { return null; }
  const mime = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const dim = imageSize(buf);
  let posY = 50;
  if (dim) {
    const [w, h] = dim;
    const side = Math.min(w, h);
    const top = Math.min(Math.trunc(h * 0.18), h - side);
    posY = h > w ? top / (h - w) * 100 : 50;
  }
  return { src: `data:${mime};base64,${buf.toString('base64')}`, posY };
}

/** 요청들을 한 번에 만든다(파이썬 한 번 실행). 결과는 요청 순서. */
export function portraits(reqs: ThumbReq[]): Array<Portrait | null> {
  const todo = reqs.filter((r) => !_cache.has(reqKey(r)));
  const uniq = [...new Map(todo.map((r) => [reqKey(r), r])).values()];
  if (uniq.length) {
    const got = runThumbs(uniq);
    uniq.forEach((r, i) => {
      const b64 = got ? got[i] : undefined;
      _cache.set(reqKey(r), b64 ? { src: `data:image/webp;base64,${b64}`, posY: null } : (got ? null : fallback(r.path)));
    });
  }
  return reqs.map((r) => _cache.get(reqKey(r)) ?? null);
}
