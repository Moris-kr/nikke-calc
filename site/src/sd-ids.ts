/**
 * 전투 결과 재생의 캐릭터별 SD — 정식 명칭 → 게임 ID(`scraper/nikke_scraped.json`의 `id`).
 * 그림은 `assets/replay/sd/<ID>-shoot.webp`·`<ID>-reload.webp`. 여기 없거나 그림이 없으면 회색 SD다.
 */
export const SD_IDS: Record<string, number> = {
  '라피 : 레드 후드': 16,
  '홍련 : 흑영': 225,
  '렘': 820,
  '아인': 391,
};
