// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { ARM_MS, confirmTwice } from './confirm-twice';

const button = (label = '삭제') => {
  const element = document.createElement('button');
  element.textContent = label;
  return element;
};

/** 시계를 손에 쥔다 — 「3초 뒤」를 실제로 3초 기다리지 않는다. */
const fakeTimer = () => {
  const jobs = new Map<number, () => void>();
  let next = 1;
  return {
    timer: {
      set: (fn: () => void) => { jobs.set(next, fn); return next++; },
      clear: (id: number) => { jobs.delete(id); },
    },
    fire: () => { for (const job of [...jobs.values()]) job(); jobs.clear(); },
    pending: () => jobs.size,
  };
};

describe('두 번 눌러야 터지는 단추', () => {
  it('한 번으로는 안 터지고, 무엇을 묻는지 단추가 말한다', () => {
    const run = vi.fn();
    const target = button();
    confirmTwice(target, run, fakeTimer());

    target.click();
    expect(run).not.toHaveBeenCalled();
    expect(target.textContent).toBe('정말 지울까요?');
    expect(target.classList.contains('is-armed')).toBe(true);

    target.click();
    expect(run).toHaveBeenCalledTimes(1);
    // 터진 뒤에는 겨눔이 풀린다 — 다음 누름이 또 지우면 안 된다.
    expect(target.textContent).toBe('삭제');
    expect(target.classList.contains('is-armed')).toBe(false);
  });

  it('빠르게 두 번 누르면(더블클릭) 그대로 지운다', () => {
    const run = vi.fn();
    const target = button();
    confirmTwice(target, run, fakeTimer());
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('겨눈 채로 두면 잠시 뒤 풀린다', () => {
    // 눌러 둔 것을 잊고 한참 뒤에 스치듯 누른 것까지 «확인»으로 세면 확인이 아니다.
    const run = vi.fn();
    const target = button();
    const clock = fakeTimer();
    confirmTwice(target, run, clock);

    target.click();
    expect(clock.pending()).toBe(1);
    clock.fire();                       // ARM_MS 경과
    expect(target.textContent).toBe('삭제');

    target.click();
    expect(run).not.toHaveBeenCalled();
    expect(ARM_MS).toBeGreaterThan(0);
  });

  it('되돌리면 그냥 단추로 돌아간다', () => {
    const run = vi.fn();
    const target = button();
    const undo = confirmTwice(target, run, fakeTimer());
    target.click();
    undo();
    expect(target.textContent).toBe('삭제');
    target.click();
    target.click();
    expect(run).not.toHaveBeenCalled();
  });
});
