import definitions from './temporary-characters.json';
import { customToMeta, customToSettings } from './custom-nikke';
import type { CharacterMeta, SettingsCatalog, SimulationRequest } from './types';

/** 공개된 스킬 원문이 없는 창작 임시 항목. 정식 수집 데이터에는 섞지 않는다. */
export function installTemporaryCharacters(
  catalog: CharacterMeta[], settings: SettingsCatalog,
): NonNullable<SimulationRequest['customCharacters']> {
  const custom: NonNullable<SimulationRequest['customCharacters']> = {};
  for (const entry of definitions) {
    // 정식 데이터가 들어오면 자동으로 정식 항목을 우선한다.
    if (catalog.some(c => c.name === entry.name)) continue;
    catalog.push({ ...customToMeta(entry), preview: true, image: entry.image });
    settings.characters[entry.name] = {
      ...customToSettings(entry), skillLevelsLocked: true,
      cube: { name: '렐릭 베어 큐브', level: 15 },
    };
    custom[entry.name] = { nikke: entry.nikke, skills: entry.skills };
  }
  return custom;
}
