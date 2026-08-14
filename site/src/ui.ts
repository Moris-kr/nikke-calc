import { ResultCache, type StorageLike } from './cache';
import { cacheKey, formatDamage, formatDps, normalizeRequest, validateRequest } from './model';
import type { CharacterMeta, SimulationRequest, SimulationResult } from './types';

const DEFAULT_SQUAD = ['리타', '크라운', '라피 : 레드 후드', '앨리스', '나가'];

export interface CalculatorClientLike {
  prepare(): Promise<void>;
  simulate(request: SimulationRequest): Promise<SimulationResult>;
  dispose(): void;
}

interface CalculatorDependencies {
  catalog: CharacterMeta[];
  version: string;
  client: CalculatorClientLike;
  storage: StorageLike;
}

const element = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`화면 요소를 찾을 수 없습니다: ${selector}`);
  return found;
};

const createText = (tag: keyof HTMLElementTagNameMap, value: string, className?: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

function initialSquad(catalog: CharacterMeta[]): string[] {
  const available = new Set(catalog.map((char) => char.name));
  const defaults = DEFAULT_SQUAD.filter((name) => available.has(name));
  const fallback = catalog.map((char) => char.name).filter((name) => !defaults.includes(name));
  return [...defaults, ...fallback].slice(0, 5);
}

export function mountCalculator(root: HTMLElement, deps: CalculatorDependencies): () => void {
  const { catalog, version, client, storage } = deps;
  const cache = new ResultCache(storage, version);
  const catalogByName = new Map(catalog.map((char) => [char.name, char]));
  const squad = initialSquad(catalog);

  root.innerHTML = `
    <div class="site-shell">
      <header class="hero">
        <div class="hero-copy">
          <p class="eyebrow">BROWSER SIM <span>·</span> 60 FPS TIMELINE</p>
          <h1><span>NIKKE</span> 스쿼드 계산기</h1>
          <p class="hero-lede">5인 편성의 버스트와 버프 타이밍을 프레임 단위로 재현해 예상 대미지를 계산합니다.</p>
          <div class="trust-row" aria-label="서비스 특징">
            <span>AI 없음</span><span>서버 전송 없음</span><span>${catalog.length}명 지원</span>
          </div>
        </div>
        <div class="hero-orbit" aria-hidden="true"><span>01</span><strong>LOCAL<br />SIM</strong></div>
      </header>

      <form class="calculator-layout" novalidate>
        <section class="panel squad-panel" aria-labelledby="squad-heading">
          <div class="section-heading">
            <div><p class="step">01 / SQUAD</p><h2 id="squad-heading">편성 선택</h2></div>
            <label class="search-field" for="character-search">
              <span>캐릭터 찾기</span>
              <input id="character-search" type="search" placeholder="이름 검색" autocomplete="off" />
            </label>
          </div>
          <div class="squad-grid" data-squad-grid></div>
        </section>

        <section class="panel settings-panel" aria-labelledby="settings-heading">
          <div class="section-heading compact">
            <div><p class="step">02 / TARGET</p><h2 id="settings-heading">전투 조건</h2></div>
          </div>
          <div class="field-grid">
            <label><span>전투 시간</span><div class="input-unit"><input id="duration" type="number" min="10" max="180" step="1" value="180" /><em>초</em></div></label>
            <label><span>적 방어력</span><input id="enemy-def" type="number" min="0" max="999999" step="1" value="31784" /></label>
            <label><span>적 코드</span><select id="enemy-code"><option value="">없음</option><option>풍압</option><option>수냉</option><option>작열</option><option>전격</option><option>철갑</option></select></label>
            <label><span>코어 직경</span><div class="input-unit"><input id="core-px" type="number" min="0" max="1000" step="1" value="0" /><em>px</em></div></label>
            <label><span>난수 시드</span><input id="seed" type="number" min="0" max="2147483647" step="1" value="42" /></label>
            <label class="toggle-field"><input id="has-parts" type="checkbox" /><span class="toggle"></span><span>파괴 가능 파츠</span></label>
          </div>
          <div class="error-box" data-errors hidden role="alert"></div>
          <button class="calculate-button" type="submit"><span>시뮬레이션 실행</span><b aria-hidden="true">→</b></button>
          <p class="status" data-status aria-live="polite">계산 엔진 준비 중…</p>
        </section>

        <section class="panel result-panel" aria-labelledby="result-heading" data-result-panel>
          <div class="result-empty">
            <p class="step">03 / RESULT</p>
            <h2 id="result-heading">전투 결과</h2>
            <div class="radar-mark" aria-hidden="true"><i></i><i></i><i></i></div>
            <p>편성과 조건을 확인한 뒤<br />시뮬레이션을 실행해 주세요.</p>
          </div>
        </section>
      </form>

      <footer>
        <p>비공식 팬 제작 도구 · 실제 전투 환경과 차이가 있을 수 있습니다.</p>
        <a href="https://github.com/Jgaram/nikke-calc" target="_blank" rel="noreferrer">SOURCE / GITHUB ↗</a>
      </footer>
    </div>
  `;

  const form = element<HTMLFormElement>(root, 'form');
  const squadGrid = element<HTMLElement>(root, '[data-squad-grid]');
  const search = element<HTMLInputElement>(root, '#character-search');
  const status = element<HTMLElement>(root, '[data-status]');
  const errors = element<HTMLElement>(root, '[data-errors]');
  const submit = element<HTMLButtonElement>(root, 'button[type="submit"]');
  const resultPanel = element<HTMLElement>(root, '[data-result-panel]');
  let activity: 'preparing' | 'ready' | 'running' | 'complete' | 'cached' | 'error' = 'preparing';

  const slots = Array.from({ length: 5 }, (_, index) => {
    const card = document.createElement('article');
    card.className = 'squad-slot';
    card.dataset.slotCard = String(index);
    card.innerHTML = `
      <div class="portrait-wrap"><span class="slot-number">0${index + 1}</span><div class="portrait-fallback" aria-hidden="true"></div></div>
      <label for="squad-${index}">슬롯 ${index + 1}</label>
      <select id="squad-${index}" data-squad-slot aria-label="스쿼드 슬롯 ${index + 1}"></select>
      <p class="char-meta" data-char-meta></p>
    `;
    squadGrid.append(card);
    return element<HTMLSelectElement>(card, 'select');
  });

  const renderSlotMeta = (index: number) => {
    const card = element<HTMLElement>(squadGrid, `[data-slot-card="${index}"]`);
    const wrap = element<HTMLElement>(card, '.portrait-wrap');
    const metaNode = element<HTMLElement>(card, '[data-char-meta]');
    const char = catalogByName.get(squad[index] ?? '');
    wrap.querySelector('img')?.remove();
    if (!char) {
      metaNode.textContent = '빈 슬롯';
      return;
    }
    metaNode.textContent = `B${char.burstStage} · ${char.elementCode} · ${char.weaponType}`;
    if (char.image) {
      const image = document.createElement('img');
      image.src = `${import.meta.env.BASE_URL}${char.image}`;
      image.alt = `${char.name} 초상화`;
      image.loading = 'lazy';
      wrap.append(image);
    }
    card.classList.toggle('is-preview', char.preview);
  };

  const renderOptions = () => {
    const query = search.value.trim().toLocaleLowerCase('ko');
    slots.forEach((select, index) => {
      const current = squad[index] ?? '';
      const taken = new Set(squad.filter((name, slotIndex) => slotIndex !== index && name));
      select.replaceChildren();
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '— 비움 —';
      select.append(empty);
      for (const char of catalog) {
        if (query && !char.name.toLocaleLowerCase('ko').includes(query) && char.name !== current) continue;
        const option = document.createElement('option');
        option.value = char.name;
        option.textContent = `${char.name}  ·  B${char.burstStage}`;
        option.disabled = taken.has(char.name);
        select.append(option);
      }
      select.value = current;
      renderSlotMeta(index);
    });
  };

  const showErrors = (messages: string[]) => {
    errors.replaceChildren();
    errors.hidden = messages.length === 0;
    for (const message of messages) errors.append(createText('p', message));
  };

  const renderResult = (result: SimulationResult, request: SimulationRequest) => {
    resultPanel.replaceChildren();
    const header = document.createElement('div');
    header.className = 'result-header';
    const copy = document.createElement('div');
    copy.append(createText('p', '03 / RESULT', 'step'), createText('h2', '전투 결과'));
    const summary = document.createElement('div');
    summary.className = 'total-block';
    const total = createText('strong', formatDamage(result.squadTotal));
    total.dataset.resultTotal = '';
    summary.append(createText('span', '스쿼드 총 대미지'), total, createText('small', formatDps(result.squadTotal / result.duration)));
    header.append(copy, summary);
    resultPanel.append(header);

    if (result.previewNote) {
      const warning = createText('p', result.previewNote, 'preview-warning');
      resultPanel.append(warning);
    }

    const rows = document.createElement('div');
    rows.className = 'result-rows';
    for (const name of request.squad) {
      const value = result.charTotals[name] ?? 0;
      const share = result.squadTotal > 0 ? value / result.squadTotal * 100 : 0;
      const row = document.createElement('article');
      row.className = 'character-result';
      row.dataset.characterResult = '';
      const top = document.createElement('div');
      top.className = 'result-row-top';
      const identity = document.createElement('div');
      identity.append(createText('h3', name), createText('span', `${share.toFixed(1)}% 기여`));
      const values = document.createElement('div');
      values.append(createText('strong', formatDamage(value)), createText('small', formatDps(value / result.duration)));
      top.append(identity, values);
      const track = document.createElement('div');
      track.className = 'share-track';
      const bar = document.createElement('i');
      bar.style.width = `${Math.max(1, share)}%`;
      track.append(bar);
      row.append(top, track);
      rows.append(row);
    }
    resultPanel.append(rows);

    const facts = document.createElement('div');
    facts.className = 'result-facts';
    facts.append(
      createText('span', `${result.duration}초 전투`),
      createText('span', `${result.hitCount.toLocaleString('ko-KR')} 히트`),
      createText('span', `시드 ${request.seed}`),
    );
    resultPanel.append(facts);
    const deviations = createText('pre', result.deviations, 'deviations');
    resultPanel.append(deviations);
  };

  const readRequest = (): SimulationRequest => normalizeRequest({
    squad: slots.map((slot) => slot.value).filter(Boolean),
    duration: Number(element<HTMLInputElement>(root, '#duration').value),
    enemyDef: Number(element<HTMLInputElement>(root, '#enemy-def').value),
    enemyCode: element<HTMLSelectElement>(root, '#enemy-code').value as SimulationRequest['enemyCode'],
    corePx: Number(element<HTMLInputElement>(root, '#core-px').value),
    hasParts: element<HTMLInputElement>(root, '#has-parts').checked,
    seed: Number(element<HTMLInputElement>(root, '#seed').value),
  });

  slots.forEach((select, index) => {
    select.addEventListener('change', () => {
      squad[index] = select.value;
      renderOptions();
      showErrors([]);
    });
  });
  search.addEventListener('input', renderOptions);
  renderOptions();

  const prepared = client.prepare()
    .then(() => {
      if (activity !== 'preparing') return;
      activity = 'ready';
      status.textContent = '계산 준비 완료 · 모든 연산은 이 기기에서 실행됩니다.';
    })
    .catch((error: unknown) => {
      if (activity !== 'preparing') return;
      activity = 'error';
      status.textContent = `초기화 실패 · ${error instanceof Error ? error.message : String(error)}`;
    });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const request = readRequest();
    const validation = validateRequest(request);
    showErrors(validation);
    if (validation.length > 0) return;

    const key = cacheKey(request, version);
    const cached = cache.get(key);
    if (cached) {
      renderResult(cached, request);
      activity = 'cached';
      status.textContent = '저장된 결과를 불러왔습니다.';
      return;
    }

    submit.disabled = true;
    submit.classList.add('is-running');
    activity = 'running';
    status.textContent = '계산 중 · 첫 실행은 엔진 준비에 시간이 걸릴 수 있습니다.';
    try {
      await prepared;
      const result = await client.simulate(request);
      cache.set(key, result);
      renderResult(result, request);
      activity = 'complete';
      status.textContent = '계산 완료 · 같은 조건은 이 기기에 저장됩니다.';
    } catch (error) {
      showErrors([error instanceof Error ? error.message : String(error)]);
      activity = 'error';
      status.textContent = '계산에 실패했습니다. 네트워크 상태를 확인하고 다시 실행해 주세요.';
    } finally {
      submit.disabled = false;
      submit.classList.remove('is-running');
    }
  });

  return () => client.dispose();
}
