// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { MCP_URL, renderMcpGuide } from './mcp-guide';

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
