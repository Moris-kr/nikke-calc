import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const parts = ['2022-2025', '2026'].map(year => read(`docs/research/pickup-history-${year}.json`));
const sources = [];
const sourceByUrl = new Map();
const events = [];
for (const part of parts) {
  const remap = new Map();
  for (const source of part.sources) {
    let id = sourceByUrl.get(source.url);
    if (!id) {
      id = `source-${sources.length + 1}`;
      sources.push({ ...source, id });
      sourceByUrl.set(source.url, id);
    }
    remap.set(source.id, id);
  }
  for (const event of part.events) {
    const sourceIds = event.sourceIds.map(id => {
      if (!remap.has(id)) throw new Error(`Unknown source ${id} in ${event.id}`);
      return remap.get(id);
    });
    const overspec = ['라피 : 레드 후드', '미하라 : 본딩 체인', '아니스 : 스타', '네온 : 비전 아이'];
    events.push({ ...event, sourceIds, ...(event.names.some(name => overspec.includes(name)) ? { tags: ['오버스펙'] } : {}) });
  }
}
events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
const data = {
  updatedAt: '2026-09-19',
  coverageNote: '2022년 11월부터 공개 일정 아카이브와 공지로 정리한 기록입니다. 모든 과거 공지를 개별 재검수한 것은 아닙니다. 날짜는 한국 시간이며 종료일 새벽에 모집이 끝날 수 있습니다. 배포 캐릭터는 콜라보 첫날 픽업 바로 다음에 별도 카드로 표시하며 당일 즉시 지급을 뜻하지 않습니다. 수령 조건과 선택 복각 방식은 상세 설명을 확인하세요. 빨강: 한정 · 금색/★: 필그림·오버스펙 · 분홍·금색 이중 테두리/✦: 한정 필그림·오버스펙. 예정 일정은 공지 기준입니다.',
  sources,
  events,
};
const output = new URL('site/public/pickup-history.json', root);
const content = `${JSON.stringify(data, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8').replaceAll('\r\n', '\n') !== content) throw new Error('Run npm run build-pickup-history to refresh pickup-history.json');
} else {
  writeFileSync(output, content);
}
console.log(`${events.length} pickup records, ${sources.length} sources: ${fileURLToPath(output)}`);
