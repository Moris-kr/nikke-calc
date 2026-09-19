import { describe, expect, it } from 'vitest';
import { VIEW_ROUTES, UTILITY_ROUTES, parseViewHash, viewHash } from './view-route';
describe('view URLs', () => {
  it('round-trips every top-level and utility destination', () => {
    for (const view of Object.keys(VIEW_ROUTES) as (keyof typeof VIEW_ROUTES)[]) {
      expect(parseViewHash(viewHash(view))).toEqual({ view });
    }
    for (const utility of Object.keys(UTILITY_ROUTES) as (keyof typeof UTILITY_ROUTES)[]) {
      expect(parseViewHash(viewHash('fun', utility))).toEqual({ view: 'fun', utility });
    }
  });
  it('handles the utility landing page, trailing slash and unknown URLs', () => {
    expect(parseViewHash('#/utilities')).toEqual({ view: 'fun', utility: 'skills' });
    expect(parseViewHash('#/utilities/mcp/')).toEqual({ view: 'fun', utility: 'mcp' });
    expect(parseViewHash('#/unknown')).toEqual({ view: 'calc' });
    expect(parseViewHash('')).toEqual({ view: 'calc' });
  });
});
