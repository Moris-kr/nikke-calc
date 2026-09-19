export const VIEW_ROUTES = {
  calc: '/calculator', union: '/union-raid', enikk: '/enikk', links: '/links',
} as const;
export const UTILITY_ROUTES = {
  pickups: '/utilities/pickups', skills: '/utilities/skills', lab: '/utilities/overload',
  mcp: '/utilities/mcp', vision: '/utilities/visualizer',
} as const;
export type ViewName = keyof typeof VIEW_ROUTES | 'fun';
export type FunView = keyof typeof UTILITY_ROUTES;
export function viewHash(view: ViewName, utility: FunView = 'skills'): string {
  return '#' + (view === 'fun' ? UTILITY_ROUTES[utility] : VIEW_ROUTES[view]);
}
export function parseViewHash(hash: string): { view: ViewName; utility?: FunView } {
  const path = hash.slice(1).replace(/\/$/, '');
  for (const [view, route] of Object.entries(VIEW_ROUTES)) {
    if (path === route) return { view: view as keyof typeof VIEW_ROUTES };
  }
  for (const [utility, route] of Object.entries(UTILITY_ROUTES)) {
    if (path === route) return { view: 'fun', utility: utility as FunView };
  }
  if (path === '/utilities') return { view: 'fun', utility: 'skills' };
  return { view: 'calc' };
}
