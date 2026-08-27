import './styles.css';

import { CalculatorPool } from './worker-client';
import { mountCalculator } from './ui';
import type { CharacterMeta, RuntimeManifest, SettingsCatalog } from './types';

const rootCandidate = document.querySelector<HTMLElement>('#app');
if (!rootCandidate) throw new Error('앱을 표시할 영역이 없습니다.');
const root: HTMLElement = rootCandidate;

root.innerHTML = '<div class="boot-screen"><span></span><p>계산기 데이터를 불러오는 중…</p></div>';

async function start(): Promise<void> {
  const [catalogResponse, manifestResponse, settingsResponse] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}catalog.json`),
    fetch(`${import.meta.env.BASE_URL}runtime/manifest.json`),
    fetch(`${import.meta.env.BASE_URL}settings.json`),
  ]);
  if (!catalogResponse.ok || !manifestResponse.ok || !settingsResponse.ok) {
    throw new Error('캐릭터 데이터를 불러오지 못했습니다.');
  }
  const catalog = await catalogResponse.json() as CharacterMeta[];
  const manifest = await manifestResponse.json() as RuntimeManifest;
  const settings = await settingsResponse.json() as SettingsCatalog;
  const client = new CalculatorPool();
  const cleanup = mountCalculator(root, {
    catalog,
    settings,
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
  title.textContent = '계산기를 시작하지 못했습니다.';
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : String(error);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '다시 시도';
  retry.addEventListener('click', () => window.location.reload());
  box.append(title, message, retry);
  root.append(box);
});
