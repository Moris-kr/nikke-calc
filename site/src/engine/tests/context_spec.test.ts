/**
 * context/test_spec.py 이식 — build_char의 컨트롤 덮어쓰기(파이썬 직접 호출 vs 브라우저 `_control_override`).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { build_char } from '../spec';
import { loadEngineData } from './helpers';

beforeAll(loadEngineData);

describe('CharacterControlOverrideTest', () => {
  it('test_missing_control_keeps_recommended_character_layer', () => {
    expect(build_char('앨리스')['control']).toHaveProperty(['tap_fire']);
  });

  it('test_direct_python_control_keeps_recursive_layer_merge', () => {
    const char = build_char('앨리스', {
      control: { reload: { policy: 'before_fb_end', lead: 0.3 } },
    });
    expect(char['control']).toHaveProperty(['tap_fire']);
    expect(char['control']).toHaveProperty(['reload']);
  });

  it('test_browser_control_override_replaces_instead_of_merging_layer', () => {
    const char = build_char('앨리스', {
      _control_override: {
        reload: { policy: 'before_fb_end', lead: 0.3 },
      },
    });
    expect(char['control']).toEqual({
      reload: { policy: 'before_fb_end', lead: 0.3 },
    });
  });

  it('test_browser_empty_control_override_clears_recommended_layer', () => {
    expect(build_char('앨리스', { _control_override: {} })['control']).toEqual({});
  });
});
