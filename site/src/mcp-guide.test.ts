// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { MCP_URL, renderMcpGuide } from './mcp-guide';
import { buildMcpShare } from './mcp-share';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('공개 주소를 복사하고 성공을 알린다', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  renderMcpGuide(document.body);
  document.querySelector<HTMLButtonElement>('[data-mcp-copy]')!.click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledWith(MCP_URL);
  expect(document.querySelector('[role="status"]')!.textContent).toContain('복사했습니다');
});

it('클립보드가 없으면 주소를 선택하고 수동 복사를 안내한다', () => {
  vi.stubGlobal('navigator', {});
  renderMcpGuide(document.body);
  document.querySelector<HTMLButtonElement>('[data-mcp-copy]')!.click();
  const input = document.querySelector<HTMLInputElement>('[data-mcp-url]')!;
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(MCP_URL.length);
  expect(document.querySelector('[role="status"]')!.textContent).toContain('Ctrl+C');
});

it('공유 버튼을 누르는 시점의 최신 설정을 복사하고 실패하면 JSON을 선택한다', async () => {
  const request = { squad: ['리타'], duration: 10, enemyDef: 0, enemyCode: '' as const, corePx: 0, hasParts: false, seed: 42 };
  const state = () => buildMcpShare({}, request, [request]);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  renderMcpGuide(document.body, state);
  request.duration = 30;
  document.querySelector<HTMLButtonElement>('[data-mcp-share-copy]')!.click();
  await Promise.resolve();
  expect(JSON.parse(writeText.mock.calls[0]![0]).decks[0].duration).toBe(30);
  writeText.mockRejectedValue(new Error('denied'));
  document.querySelector<HTMLButtonElement>('[data-mcp-share-copy]')!.click();
  await Promise.resolve();
  const fallback = document.querySelector<HTMLTextAreaElement>('[data-mcp-share-fallback]')!;
  expect(fallback.hidden).toBe(false);
  expect(JSON.parse(fallback.value).format).toBe('nikke-calc-mcp');
  expect(fallback.selectionEnd).toBe(fallback.value.length);
});
