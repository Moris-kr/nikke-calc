// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { itemIcon, itemIconUrl, MODULE_ITEM, prependItemIcon } from './item-icons';

describe('아이템 아이콘', () => {
  it('매뉴얼은 기존 PNG, 코드 매뉴얼·커스텀 모듈은 items/ WebP, 모르는 ID는 null', () => {
    expect(itemIconUrl('7092003')).toMatch(/manuals\/7092003\.png$/);
    expect(itemIconUrl('7093004')).toMatch(/items\/7093004\.webp$/);
    expect(itemIconUrl(MODULE_ITEM)).toMatch(/items\/7080001\.webp$/);
    expect(itemIconUrl('99')).toBeNull();
    expect(itemIcon('99')).toBeNull();
  });

  it('글자 앞에 장식 아이콘을 붙이고 글자는 그대로 둔다', () => {
    const label = document.createElement('strong');
    label.textContent = '모듈 12.0개';
    prependItemIcon(label, MODULE_ITEM);
    expect(label.firstElementChild?.tagName).toBe('IMG');
    expect(label.textContent).toBe('모듈 12.0개');
    const none = document.createElement('span');
    none.textContent = '락 키';
    prependItemIcon(none, 'lock-key');
    expect(none.children).toHaveLength(0);
  });
});
