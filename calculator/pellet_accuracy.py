"""Shotgun body/core probabilities. Drawing mode uses the existing radial model,
not a newly claimed measurement of the game's pellet distribution.
"""
import math
from functools import lru_cache


def contains(shape, x, y):
    kind, sx, sy, w, h, rotation = shape
    if w <= 0 or h <= 0:
        return False
    angle = math.radians(-rotation)
    dx, dy = x - sx, y - sy
    lx = dx * math.cos(angle) - dy * math.sin(angle)
    ly = dx * math.sin(angle) + dy * math.cos(angle)
    if kind == 'circle':
        return (lx / (w / 2)) ** 2 + (ly / (h / 2)) ** 2 <= 1
    if kind == 'rect':
        return abs(lx) <= w / 2 and abs(ly) <= h / 2
    ratio = (ly + h / 2) / h
    return 0 <= ratio <= 1 and abs(lx) <= w / 2 * ratio


def aim_at(geometry, t):
    keys = sorted(geometry.get('aimKeys', []), key=lambda k: k['t'])
    if not keys:
        return geometry.get('core') or geometry.get('center')
    if t <= keys[0]['t']:
        return keys[0]
    for before, after in zip(keys, keys[1:]):
        if t <= after['t']:
            ratio = (t - before['t']) / (after['t'] - before['t'])
            return {axis: before[axis] + (after[axis] - before[axis]) * ratio for axis in ('x', 'y')}
    return keys[-1]


@lru_cache(maxsize=4096)
def integrate(shapes, aim, radius, core, exponent):
    """Deterministic equal-probability quadrature (1024 points); overlaps count once."""
    hits = cores = 0
    for i in range(1024):
        r = radius * ((i + .5) / 1024) ** (1 / exponent)
        angle = i * 2.399963229728653
        x, y = aim[0] + r * math.cos(angle), aim[1] + r * math.sin(angle)
        if any(contains(shape, x, y) for shape in shapes):
            hits += 1
            if core and (x - core[0]) ** 2 + (y - core[1]) ** 2 <= core[2] ** 2:
                cores += 1
    return hits / 1024, cores / hits if hits else 0


def scene_at(enemy, name, t, full_burst, radius):
    """Resolve the exact spatial inputs once for both integration and diagnostics."""
    geometry = enemy.get('shotgun_geometry')
    if geometry is None and enemy.get('shotgun_model') in ('spatial-v1', 'spatial-convergence-v1'):
        # Same coordinate units as the existing core/boss canvas, not a claim
        # that raw CDN scale values are physical screen pixels.
        diameter = float(enemy.get('shotgun_target_diameter', 360))
        core_d = float(enemy.get('core_px', 0))
        return ((('circle', 0, 0, diameter, diameter, 0),), (0, 0), radius,
                (0, 0, core_d / 2) if core_d > 0 else None)
    if geometry is None:
        return None
    aim = aim_at(geometry, t)
    if not full_burst and name != geometry.get('playerName'):
        aim = geometry.get('center') or aim
    if not aim:
        return ((), (0, 0), radius, None)
    shapes = tuple((s['kind'], s['x'], s['y'], s['w'], s['h'], s.get('rotation', 0))
                   for s in geometry.get('shapes', []) + geometry.get('parts', [])
                   if not s.get('windows') or any(a <= t < b for a, b in s['windows']))
    core = geometry.get('core')
    core = (core['x'], core['y'], core['d'] / 2) if core and enemy.get('core_px', 0) > 0 else None
    override = geometry.get('spread', {}).get(name)
    if override and override > 0:
        radius = override / 2
    return shapes, (aim['x'], aim['y']), radius, core


def probabilities(enemy, name, t, full_burst, radius, core_probability, exponent=2.55):
    scene = scene_at(enemy, name, t, full_burst, radius)
    if scene is None:
        return max(0, min(1, float(enemy.get('shotgun_hit_rate', 1)))), core_probability
    return integrate(*scene, exponent)


@lru_cache(maxsize=1024)
def at_least(n, probability, minimum):
    return sum(math.comb(n, k) * probability ** k * (1 - probability) ** (n - k)
               for k in range(minimum, n + 1))
