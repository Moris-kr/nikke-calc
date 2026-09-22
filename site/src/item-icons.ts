/**
 * 게임 아이템 아이콘 — 매뉴얼·코드 매뉴얼·커스텀 모듈.
 *
 * 스킬·버스트 매뉴얼 6종은 스킬칩 계산기가 쓰던 `public/manuals/<ID>.png` 그대로, 코드 매뉴얼
 * 5종과 커스텀 모듈은 `public/items/<ID>.webp`(nikke.gg 아이템 목록의 아이콘을 96px로 줄인 것)다.
 * ID는 게임 아이템 번호라 `skill-costs.json`의 재료 키와 같다.
 *
 * 그림은 **장식**이다 — 이름은 언제나 옆 글자가 말하므로 alt를 비워 읽기 도구가 두 번 읽지 않게 한다.
 * 커스텀락키는 받을 수 있는 아이콘이 없어 글자만 둔다.
 */

export const MODULE_ITEM = '7080001';

const MANUAL_IDS = new Set(['7091001', '7091002', '7091003', '7092001', '7092002', '7092003']);
const ITEM_IDS = new Set(['7093001', '7093002', '7093003', '7093004', '7093005', MODULE_ITEM]);

export function itemIconUrl(id: string): string | null {
  if (MANUAL_IDS.has(id)) return `${import.meta.env.BASE_URL}manuals/${id}.png`;
  if (ITEM_IDS.has(id)) return `${import.meta.env.BASE_URL}items/${id}.webp`;
  return null;
}

/** 글자 옆에 붙는 작은 아이콘. 모르는 ID면 null — 부르는 쪽은 글자만 둔다. */
export function itemIcon(id: string, className = 'item-icon'): HTMLImageElement | null {
  const url = itemIconUrl(id);
  if (!url) return null;
  const image = document.createElement('img');
  image.className = className;
  image.src = url;
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'lazy';
  image.dataset.itemIcon = id;
  return image;
}

/** 노드 맨 앞에 아이콘을 붙인다. 아이콘이 없으면 아무것도 안 한다. */
export function prependItemIcon(node: Element, id: string, className?: string): void {
  const icon = itemIcon(id, className);
  if (icon) node.prepend(icon);
}
