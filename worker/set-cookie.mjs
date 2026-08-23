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

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 파일 경로를 주면 그 파일을, 안 주면 클립보드를 읽는다. "Copy as cURL" 직후에
// 인자 없이 돌리는 게 가장 짧고, 파일을 남기지 않아 지울 것도 없다.
const source = process.argv[2];
let text;
if (source) {
  text = readFileSync(source, 'utf8');
} else if (process.platform === 'win32') {
  const clip = spawnSync('powershell.exe',
    ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', maxBuffer: 4 << 20 });
  if (clip.status !== 0) {
    console.error('[!] 클립보드를 읽지 못했습니다. 파일 경로를 인자로 주세요.');
    process.exit(1);
  }
  text = clip.stdout;
} else {
  console.error('사용법: node worker/set-cookie.mjs <Copy as cURL을 붙여넣은 파일>');
  process.exit(1);
}
// -H 'Cookie: …' / -H "Cookie: …" / -b '…' 어느 형태로 나오든 받는다.
const match = text.match(/-H\s+(['"])cookie:\s*([\s\S]*?)\1/i)
  ?? text.match(/-b\s+(['"])([\s\S]*?)\1/);
if (!match) {
  console.error('[!] Cookie 헤더를 찾지 못했습니다. api.blablalink.com 요청을 '
    + '"Copy as cURL"로 복사했는지 확인해 주세요.');
  console.error(`    (읽은 내용 ${text.length}자, 앞부분: ${JSON.stringify(text.slice(0, 60))})`);
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

// 넣기 전에 이 컴퓨터에서 먼저 확인한다. 워커에 넣고 나서 실패하면 "쿠키가 틀렸나
// 워커가 문제인가"를 가릴 수 없는데, 여기서 통과하면 쿠키는 확실히 살아 있는 것이다.
const COMMON = { game_id: '29080', area_id: 'global', source: 'pc_web',
                 intl_game_id: '29080', language: 'ko', env: 'prod' };
const probe = await fetch(
  'https://api.blablalink.com/api/ugc/proxy/standalonesite/User/GetUserInfoNew',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/151.0.0.0 Safari/537.36',
      Origin: 'https://www.blablalink.com',
      Referer: 'https://www.blablalink.com/',
      'X-Channel-Type': '2',
      'X-Language': 'ko',
      'X-Common-Params': JSON.stringify(COMMON),
      Cookie: cookie,
    },
    body: '{}',
  },
).then((r) => r.json()).catch((error) => ({ code: -1, msg: String(error).slice(0, 100) }));

if (probe.code !== 0) {
  console.error(`[!] 이 쿠키로는 로그인이 안 됩니다 (${probe.code} ${probe.msg}).`);
  console.error('    블라블라링크에 로그인된 상태에서 api.blablalink.com 요청을 다시 '
    + '"Copy as cURL"로 복사해 주세요. 넣지 않고 멈춥니다.');
  process.exit(1);
}
const openid = probe.data?.info?.intl_openid;
console.log(`[+] 로그인 확인 — openid …${String(openid ?? '').slice(-4)}`);

// wrangler는 stdin으로 값을 받으므로 값을 그대로 넘긴다 — 디스크에 남기지 않는다.
// Windows에서는 `npx`가 배치 파일이라 shell 없이는 실행되지 않는다.
const workerDir = fileURLToPath(new URL('.', import.meta.url));
const result = spawnSync('npx wrangler secret put BLABLA_COOKIE', {
  cwd: workerDir,
  shell: true,
  input: cookie,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (result.error) {
  console.error('[!] wrangler를 실행하지 못했습니다:', result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`[!] wrangler가 ${result.status}로 끝났습니다.`);
  process.exit(result.status ?? 1);
}
console.log('[+] BLABLA_COOKIE 저장 완료');
