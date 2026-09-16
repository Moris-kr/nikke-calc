import './styles.css';

declare const __BUILD_ID__: string;

import { CalculatorPool } from './worker-client';
import { detectLang, LANG_KEY, setLang, setLocaleNames, t, type LocaleNames } from './i18n';
import { mountCalculator } from './ui';
import { installTemporaryCharacters } from './temporary-characters';
import type { CharacterMeta, RuntimeManifest, SettingsCatalog } from './types';

// 말을 먼저 정한다 — 첫 글자(「불러오는 중」)부터 그 사람의 말이어야 한다.
// 저장해 둔 것이 먼저고, 없으면 브라우저가 말하는 언어를 따른다.
setLang(detectLang(
  (() => { try { return window.localStorage.getItem(LANG_KEY); } catch { return null; } })(),
  navigator.languages ?? [navigator.language],
));

// 탭 제목도 그 사람의 말로. `index.html`은 한국어로 박혀 있고(첫 그림·공유 미리보기가
// 그 값을 쓴다), 화면이 뜨는 순간 고른 말로 바꾼다.
document.title = t('NIKKE 스쿼드 계산기');

const rootCandidate = document.querySelector<HTMLElement>('#app');
if (!rootCandidate) throw new Error(t('앱을 표시할 영역이 없습니다.'));
const root: HTMLElement = rootCandidate;

root.innerHTML = `<div class="boot-screen"><span></span><p>${t('계산기 데이터를 불러오는 중…')}</p></div>`;

async function start(): Promise<void> {
  // 배포 직후에도 이전 순번 이미지 URL을 담은 목록을 캐시에서 가져오지 않는다.
  const dataUrl = (path: string) => `${import.meta.env.BASE_URL}${path}?v=${__BUILD_ID__}`;
  const [catalogResponse, manifestResponse, settingsResponse] = await Promise.all([
    fetch(dataUrl('catalog.json'), { cache: 'no-cache' }),
    fetch(dataUrl('runtime/manifest.json'), { cache: 'no-cache' }),
    fetch(dataUrl('settings.json'), { cache: 'no-cache' }),
  ]);
  if (!catalogResponse.ok || !manifestResponse.ok || !settingsResponse.ok) {
    throw new Error(t('캐릭터 데이터를 불러오지 못했습니다.'));
  }
  // 캐릭터·스킬 이름표. 한국어로 보는 사람에게는 받을 이유가 없다(60KB).
  // 없어도 화면은 한국어 이름으로 굴러가므로 실패해도 멈추지 않는다.
  if (document.documentElement.lang !== 'ko') {
    try {
      const namesResponse = await fetch(`${import.meta.env.BASE_URL}locale-text.json`);
      if (namesResponse.ok) setLocaleNames(await namesResponse.json() as LocaleNames);
    } catch { /* 이름표가 없으면 한국어 이름 그대로 */ }
  }
  const catalog = await catalogResponse.json() as CharacterMeta[];
  const manifest = await manifestResponse.json() as RuntimeManifest;
  const settings = await settingsResponse.json() as SettingsCatalog;
  const bundledCharacters = installTemporaryCharacters(catalog, settings);
  const client = new CalculatorPool();
  const cleanup = mountCalculator(root, {
    catalog,
    settings,
    bundledCharacters,
    version: manifest.version,
    client,
    storage: () => window.localStorage,
  });
  window.addEventListener('pagehide', cleanup, { once: true });
}

start().catch((error: unknown) => {
  root.replaceChildren();
  const box = document.createElement('section');
  box.className = 'fatal-error';
  const title = document.createElement('h1');
  title.textContent = t('계산기를 시작하지 못했습니다.');
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = t('다시 시도');
  retry.addEventListener('click', () => window.location.reload());
  box.append(title, message, retry);
  root.append(box);
});
