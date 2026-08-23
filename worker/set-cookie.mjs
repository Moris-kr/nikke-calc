// DevTools "Copy as cURL"로 복사한 텍스트에서 `Cookie:` 헤더만 뽑아 시크릿으로 넣는다.
//
// 손으로 `game_token=…; game_openid=…`를 조립하면 상류가 거절한다(실측 2026-08-23).
// 실제 요청은 그 둘 말고도 여러 쿠키를 함께 싣기 때문이다. 헤더를 통째로 옮기는 게
// 유일하게 확실한 방법이고, 그 과정에서 값이 화면에 찍히지 않게 이 스크립트를 쓴다.
//
// 사용법:
//   1. blablalink.com 로그인 상태에서 F12 > Network
//   2. `api.blablalink.com` 요청 우클릭 > Copy > Copy as cURL (bash)
//   3. 아무 파일에 붙여넣고 저장 (예: curl.txt)
//   4. node worker/set-cookie.mjs curl.txt
//
// 쿠키 값은 stdout에 절대 찍지 않고 wrangler에 바로 넘긴다.

import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = process.argv[2];
if (!source) {
  console.error('사용법: node worker/set-cookie.mjs <Copy as cURL을 붙여넣은 파일>');
  process.exit(1);
}

const text = readFileSync(source, 'utf8');
// -H 'Cookie: …' / -H "Cookie: …" / -b '…' 어느 형태로 나오든 받는다.
const match = text.match(/-H\s+(['"])cookie:\s*([\s\S]*?)\1/i)
  ?? text.match(/-b\s+(['"])([\s\S]*?)\1/);
if (!match) {
  console.error('[!] Cookie 헤더를 찾지 못했습니다. api.blablalink.com 요청을 '
    + '"Copy as cURL"로 복사했는지 확인해 주세요.');
  process.exit(1);
}

const cookie = match[2].replace(/\s*\\s*\n\s*/g, '').trim();
const names = cookie.split(';').map((part) => part.trim().split('=')[0]).filter(Boolean);

console.log(`쿠키 ${names.length}개 · ${cookie.length}자`);
console.log('이름:', names.join(', '));
const missing = ['game_token', 'game_openid'].filter((name) => !names.includes(name));
if (missing.length > 0) {
  console.error(`[!] ${missing.join(', ')}가 없습니다. 로그인 상태인지, `
    + 'api.blablalink.com 요청을 골랐는지 확인해 주세요.');
  process.exit(1);
}
if (names.length <= 2) {
  console.error('[!] 쿠키가 2개뿐입니다 — 헤더 전체가 아니라 일부만 복사된 것 같습니다.');
  process.exit(1);
}

// wrangler는 stdin으로 값을 받는다. 임시 파일에 담아 넘기고 바로 지운다.
const temp = join(tmpdir(), `blabla-cookie-${process.pid}`);
writeFileSync(temp, cookie, { encoding: 'utf8' });
try {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'secret', 'put', 'BLABLA_COOKIE'],
    { cwd: new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      stdio: [readFileSync(temp) ? 'pipe' : 'inherit', 'inherit', 'inherit'],
      input: cookie },
  );
  process.exit(result.status ?? 1);
} finally {
  try { unlinkSync(temp); } catch { /* 이미 없으면 그만 */ }
}
