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
  coverageNote: '2022년 11월부터 공개 일정 아카이브와 공지로 정리한 기록입니다. 주요 오류와 최근 복각을 대조했으며, 모든 과거 공지를 개별 재검수한 것은 아닙니다. 날짜는 한국 시간이며 종료일 새벽에 모집이 끝날 수 있습니다. 묶음 카드는 동시 모집 또는 선택 복각으로, 정확한 방식은 상세 설명을 확인하세요. 빨간 테두리: 한정 · 금색 테두리: 필그림/오버스펙. 예정 일정은 공지 기준입니다.',
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
