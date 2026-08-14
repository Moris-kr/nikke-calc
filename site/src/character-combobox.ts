import type { CharacterMeta } from './types';

type BurstFilter = 'all' | '1' | '2' | '3';

export interface CharacterComboboxOptions {
  idPrefix: string;
  slotLabel: string;
  catalog: CharacterMeta[];
  selectedName: string;
  takenNames: Set<string>;
  baseUrl: string;
  onOpen: (combobox: CharacterCombobox) => void;
  onClose: (combobox: CharacterCombobox) => void;
  onSelect: (name: string) => void;
}

export interface CharacterCombobox {
  element: HTMLElement;
  open(): void;
  close(options?: { restoreFocus?: boolean }): void;
  destroy(): void;
}

function createText(tag: string, text: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function searchableText(character: CharacterMeta): string {
  return [
    character.name,
    `B${character.burstStage}`,
    character.elementCode,
    character.weaponType,
    character.className,
    character.manufacturer,
  ].join(' ').toLocaleLowerCase('ko');
}

export function createCharacterCombobox(options: CharacterComboboxOptions): CharacterCombobox {
  const selected = options.catalog.find((character) => character.name === options.selectedName);
  const root = document.createElement('div');
  root.className = 'character-combobox';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = options.idPrefix;
  trigger.className = 'character-trigger';
  trigger.dataset.characterTrigger = '';
  trigger.dataset.squadSlot = '';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${options.idPrefix}-panel`);
  trigger.setAttribute('aria-label', `${options.slotLabel}: ${selected?.name ?? '캐릭터 선택'}`);
  const triggerCopy = document.createElement('span');
  triggerCopy.className = 'character-trigger-copy';
  triggerCopy.append(
    createText('strong', selected?.name ?? '캐릭터 선택'),
    createText(
      'small',
      selected ? `B${selected.burstStage} · ${selected.elementCode} · ${selected.weaponType}` : '빈 슬롯',
    ),
  );
  trigger.append(triggerCopy, createText('span', '⌄', 'character-trigger-mark'));

  const panel = document.createElement('div');
  panel.id = `${options.idPrefix}-panel`;
  panel.className = 'character-panel';
  panel.hidden = true;

  const searchLabel = document.createElement('label');
  searchLabel.className = 'character-search';
  searchLabel.htmlFor = `${options.idPrefix}-search`;
  searchLabel.append(createText('span', '캐릭터 검색'));
  const search = document.createElement('input');
  search.id = `${options.idPrefix}-search`;
  search.type = 'search';
  search.placeholder = '이름·코드·무기·제조사 검색';
  search.autocomplete = 'off';
  search.dataset.characterSearch = '';
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');
  search.setAttribute('aria-controls', `${options.idPrefix}-listbox`);
  search.setAttribute('aria-expanded', 'true');
  searchLabel.append(search);

  const filters = document.createElement('div');
  filters.className = 'burst-filters';
  filters.setAttribute('aria-label', '버스트 단계 필터');
  const filterLabels: Array<[BurstFilter, string]> = [
    ['all', '전체'],
    ['1', 'B1'],
    ['2', 'B2'],
    ['3', 'B3'],
  ];
  for (const [value, label] of filterLabels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'burst-filter';
    button.dataset.burstFilter = value;
    button.textContent = label;
    button.setAttribute('aria-pressed', String(value === 'all'));
    filters.append(button);
  }

  const listbox = document.createElement('div');
  listbox.id = `${options.idPrefix}-listbox`;
  listbox.className = 'character-results';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', `${options.slotLabel} 캐릭터 목록`);
  panel.append(searchLabel, filters, listbox);
  root.append(trigger, panel);

  let isOpen = false;
  let destroyed = false;
  let burstFilter: BurstFilter = 'all';
  let activeValue: string | null = options.selectedName || '';

  const selectableRows = (): HTMLElement[] => [
    ...listbox.querySelectorAll<HTMLElement>('[data-character-value]:not([aria-disabled="true"])'),
  ];

  const setActive = (value: string | null, scroll = false) => {
    activeValue = value;
    let active: HTMLElement | null = null;
    for (const row of listbox.querySelectorAll<HTMLElement>('[data-character-value]')) {
      const matches = row.dataset.characterValue === value;
      row.classList.toggle('is-active', matches);
      if (matches) active = row;
    }
    if (active) {
      search.setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView?.({ block: 'nearest' });
    } else {
      search.removeAttribute('aria-activedescendant');
    }
  };

  const selectValue = (value: string) => {
    options.onSelect(value);
    controller.close({ restoreFocus: true });
  };

  const createOption = (character: CharacterMeta, index: number): HTMLElement => {
    const disabled = options.takenNames.has(character.name);
    const row = document.createElement('div');
    row.id = `${options.idPrefix}-option-${index}`;
    row.className = 'character-option';
    row.dataset.characterOption = character.name;
    row.dataset.characterValue = character.name;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(character.name === options.selectedName));
    row.setAttribute('aria-disabled', String(disabled));

    const portrait = document.createElement('span');
    portrait.className = 'character-option-portrait';
    if (character.image) {
      const image = document.createElement('img');
      image.src = `${options.baseUrl}${character.image}`;
      image.alt = '';
      image.loading = 'lazy';
      portrait.append(image);
    } else {
      portrait.append(createText('span', character.name.slice(0, 1)));
    }

    const copy = document.createElement('span');
    copy.className = 'character-option-copy';
    copy.append(
      createText('strong', character.name),
      createText(
        'small',
        `B${character.burstStage} · ${character.elementCode} · ${character.weaponType} · ${character.manufacturer}`,
      ),
    );
    row.append(portrait, copy);
    if (disabled) row.append(createText('span', '편성 중', 'character-option-status'));
    row.addEventListener('pointermove', () => {
      if (!disabled) setActive(character.name);
    });
    row.addEventListener('click', () => {
      if (!disabled) selectValue(character.name);
    });
    return row;
  };

  const renderResults = (preferFirstMatch = false) => {
    const query = search.value.trim().toLocaleLowerCase('ko');
    const matches = options.catalog.filter((character) => (
      (!query || searchableText(character).includes(query))
      && (burstFilter === 'all' || character.burstStage === burstFilter)
    ));
    listbox.replaceChildren();

    const clear = document.createElement('div');
    clear.id = `${options.idPrefix}-option-clear`;
    clear.className = 'character-option character-option-clear';
    clear.dataset.characterClear = '';
    clear.dataset.characterValue = '';
    clear.setAttribute('role', 'option');
    clear.setAttribute('aria-selected', String(!options.selectedName));
    clear.setAttribute('aria-disabled', 'false');
    clear.append(
      createText('span', '×', 'character-option-portrait'),
      createText('strong', '슬롯 비우기'),
    );
    clear.addEventListener('pointermove', () => setActive(''));
    clear.addEventListener('click', () => selectValue(''));
    listbox.append(clear);

    matches.forEach((character, index) => listbox.append(createOption(character, index)));
    if (matches.length === 0) {
      const empty = createText('p', '검색 결과가 없습니다.', 'character-empty');
      empty.dataset.characterEmpty = '';
      listbox.append(empty);
    }

    const enabled = selectableRows();
    const firstCharacter = enabled.find((row) => row.dataset.characterValue);
    const retained = enabled.find((row) => row.dataset.characterValue === activeValue);
    if (preferFirstMatch && (query || burstFilter !== 'all')) {
      setActive(firstCharacter?.dataset.characterValue ?? '');
    } else {
      setActive(retained?.dataset.characterValue ?? firstCharacter?.dataset.characterValue ?? '');
    }
  };

  const moveActive = (direction: -1 | 1 | 'home' | 'end') => {
    const rows = selectableRows();
    if (rows.length === 0) return;
    const currentIndex = rows.findIndex((row) => row.dataset.characterValue === activeValue);
    let nextIndex: number;
    if (direction === 'home') nextIndex = 0;
    else if (direction === 'end') nextIndex = rows.length - 1;
    else if (currentIndex < 0) nextIndex = direction === 1 ? 0 : rows.length - 1;
    else nextIndex = (currentIndex + direction + rows.length) % rows.length;
    setActive(rows[nextIndex]?.dataset.characterValue ?? null, true);
  };

  const onDocumentPointerDown = (event: Event) => {
    if (!root.contains(event.target as Node)) controller.close();
  };

  const controller: CharacterCombobox = {
    element: root,
    open() {
      if (destroyed || isOpen) return;
      options.onOpen(controller);
      isOpen = true;
      search.value = '';
      burstFilter = 'all';
      activeValue = options.selectedName || '';
      for (const button of filters.querySelectorAll<HTMLButtonElement>('[data-burst-filter]')) {
        button.setAttribute('aria-pressed', String(button.dataset.burstFilter === 'all'));
      }
      renderResults();
      panel.hidden = false;
      root.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onDocumentPointerDown);
      search.focus();
    },
    close({ restoreFocus = false } = {}) {
      if (!isOpen) return;
      isOpen = false;
      panel.hidden = true;
      root.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDocumentPointerDown);
      options.onClose(controller);
      if (restoreFocus) trigger.focus();
    },
    destroy() {
      if (destroyed) return;
      controller.close();
      destroyed = true;
      root.remove();
    },
  };

  trigger.addEventListener('click', () => {
    if (isOpen) controller.close();
    else controller.open();
  });
  search.addEventListener('input', () => renderResults(true));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveActive('home');
    } else if (event.key === 'End') {
      event.preventDefault();
      moveActive('end');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = selectableRows().find((row) => row.dataset.characterValue === activeValue);
      if (active) selectValue(active.dataset.characterValue ?? '');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      controller.close({ restoreFocus: true });
    }
  });
  filters.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-burst-filter]');
    if (!button) return;
    burstFilter = button.dataset.burstFilter as BurstFilter;
    for (const candidate of filters.querySelectorAll<HTMLButtonElement>('[data-burst-filter]')) {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    }
    renderResults(true);
    search.focus();
  });

  return controller;
}
