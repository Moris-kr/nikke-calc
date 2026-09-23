/**
 * 파이썬 `difflib.unified_diff`(문자열 목록) — CPython 3.12 `SequenceMatcher`를 그대로 옮겼다.
 * 스냅샷 하네스의 L3 순서 diff가 파이썬 시절과 같은 줄을 내도록 쓴다.
 */

type Opcode = [tag: string, i1: number, i2: number, j1: number, j2: number];

class SequenceMatcher {
  private b2j = new Map<string, number[]>();
  private bjunk = new Set<string>();

  constructor(private a: string[], private b: string[], autojunk = true) {
    for (let i = 0; i < b.length; i += 1) {
      const elt = b[i]!;
      let idx = this.b2j.get(elt);
      if (!idx) { idx = []; this.b2j.set(elt, idx); }
      idx.push(i);
    }
    // isjunk는 None — 흔한 원소만 걸러 낸다(autojunk).
    const n = b.length;
    if (autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      const popular: string[] = [];
      for (const [elt, idxs] of this.b2j) if (idxs.length > ntest) popular.push(elt);
      for (const elt of popular) this.b2j.delete(elt);
    }
  }

  private findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
    const { a, b, b2j, bjunk } = this;
    let besti = alo; let bestj = blo; let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i += 1) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    const isbjunk = (x: string): boolean => bjunk.has(x);
    while (besti > alo && bestj > blo && !isbjunk(b[bestj - 1]!) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1; bestj -= 1; bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && !isbjunk(b[bestj + bestsize]!)
      && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    while (besti > alo && bestj > blo && isbjunk(b[bestj - 1]!) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1; bestj -= 1; bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && isbjunk(b[bestj + bestsize]!)
      && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }
    return [besti, bestj, bestsize];
  }

  private matchingBlocks(): Array<[number, number, number]> {
    const la = this.a.length; const lb = this.b.length;
    const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
    const blocks: Array<[number, number, number]> = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {
        blocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    let i1 = 0; let j1 = 0; let k1 = 0;
    const out: Array<[number, number, number]> = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) out.push([i1, j1, k1]);
        i1 = i2; j1 = j2; k1 = k2;
      }
    }
    if (k1) out.push([i1, j1, k1]);
    out.push([la, lb, 0]);
    return out;
  }

  private opcodes(): Opcode[] {
    let i = 0; let j = 0;
    const answer: Opcode[] = [];
    for (const [ai, bj, size] of this.matchingBlocks()) {
      let tag = '';
      if (i < ai && j < bj) tag = 'replace';
      else if (i < ai) tag = 'delete';
      else if (j < bj) tag = 'insert';
      if (tag) answer.push([tag, i, ai, j, bj]);
      i = ai + size; j = bj + size;
      if (size) answer.push(['equal', ai, i, bj, j]);
    }
    return answer;
  }

  groupedOpcodes(n = 3): Opcode[][] {
    let codes = this.opcodes();
    if (!codes.length) codes = [['equal', 0, 1, 0, 1]];
    if (codes[0]![0] === 'equal') {
      const [tag, i1, i2, j1, j2] = codes[0]!;
      codes[0] = [tag, Math.max(i1, i2 - n), i2, Math.max(j1, j2 - n), j2];
    }
    if (codes[codes.length - 1]![0] === 'equal') {
      const [tag, i1, i2, j1, j2] = codes[codes.length - 1]!;
      codes[codes.length - 1] = [tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)];
    }
    const nn = n + n;
    const groups: Opcode[][] = [];
    let group: Opcode[] = [];
    for (const code of codes) {
      let [tag, i1, i2, j1, j2] = code;
      if (tag === 'equal' && i2 - i1 > nn) {
        group.push([tag, i1, Math.min(i2, i1 + n), j1, Math.min(j2, j1 + n)]);
        groups.push(group);
        group = [];
        i1 = Math.max(i1, i2 - n); j1 = Math.max(j1, j2 - n);
      }
      group.push([tag, i1, i2, j1, j2]);
    }
    if (group.length && !(group.length === 1 && group[0]![0] === 'equal')) groups.push(group);
    return groups;
  }
}

function formatRangeUnified(start: number, stop: number): string {
  let beginning = start + 1;
  const length = stop - start;
  if (length === 1) return `${beginning}`;
  if (!length) beginning -= 1;
  return `${beginning},${length}`;
}

/** `difflib.unified_diff(a, b, lineterm="", n=n)` (파일 이름·날짜는 비워 둔다). */
export function unifiedDiff(a: string[], b: string[], n = 3): string[] {
  const out: string[] = [];
  let started = false;
  for (const group of new SequenceMatcher(a, b).groupedOpcodes(n)) {
    if (!started) {
      started = true;
      out.push('--- ', '+++ ');
    }
    const first = group[0]!; const last = group[group.length - 1]!;
    out.push(`@@ -${formatRangeUnified(first[1], last[2])} +${formatRangeUnified(first[3], last[4])} @@`);
    for (const [tag, i1, i2, j1, j2] of group) {
      if (tag === 'equal') {
        for (const line of a.slice(i1, i2)) out.push(' ' + line);
        continue;
      }
      if (tag === 'replace' || tag === 'delete') for (const line of a.slice(i1, i2)) out.push('-' + line);
      if (tag === 'replace' || tag === 'insert') for (const line of b.slice(j1, j2)) out.push('+' + line);
    }
  }
  return out;
}
