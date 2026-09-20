"""Opt-in deterministic diagnostics. Never consumes combat RNG or changes damage."""
import math
from .pellet_accuracy import scene_at, contains


class ShotgunHeatmap:
    def __init__(self):
        self.frames = []
        self.scenes = []
        self.indices = {}

    def record(self, enemy, name, t, full_burst, radius, accuracy, pellets, hit, core, exponent):
        scene = scene_at(enemy, name, t, full_burst, radius)
        key = (scene, radius if scene is None else 0, exponent)
        if key not in self.indices:
            self.indices[key] = len(self.scenes)
            shapes, aim, actual_radius, core_shape = scene or ((), (0, 0), radius, None)
            self.scenes.append({'shapes': shapes, 'aim': aim, 'radius': actual_radius,
                                'core': core_shape, 'spatial': scene is not None, 'exponent': exponent})
        self.frames.append({'t': round(t, 4), 'scene': self.indices[key], 'pellets': pellets,
                            'hit': hit, 'core': core, 'accuracy': accuracy, 'fullBurst': full_burst})

    def finish(self):
        size = 48
        extents = []
        for scene in self.scenes:
            x, y = scene['aim']
            r = scene['radius']
            extents.append((x-r, y-r, x+r, y+r))
            for _, x, y, w, h, _ in scene['shapes']:
                r = math.hypot(w, h)/2
                extents.append((x-r, y-r, x+r, y+r))
        x0, y0 = min(e[0] for e in extents), min(e[1] for e in extents)
        x1, y1 = max(e[2] for e in extents), max(e[3] for e in extents)
        side = max(x1-x0, y1-y0, 1)*1.08
        bounds = [(x0+x1-side)/2, (y0+y1-side)/2, side, side]
        grids = {key: [0.0]*(size*size) for key in ('density', 'body', 'core', 'miss')}
        weights = [0]*len(self.scenes)
        for frame in self.frames:
            weights[frame['scene']] += frame['pellets']
        for scene, weight in zip(self.scenes, weights):
            for i in range(1024):
                r = scene['radius']*((i+.5)/1024)**(1/scene['exponent'])
                angle = i*2.399963229728653
                x = scene['aim'][0]+r*math.cos(angle)
                y = scene['aim'][1]+r*math.sin(angle)
                col = min(size-1, max(0, int((x-bounds[0])/side*size)))
                row = min(size-1, max(0, int((y-bounds[1])/side*size)))
                cell = row*size+col
                grids['density'][cell] += weight/1024
                if scene['spatial']:
                    c = scene['core']
                    hit = any(contains(s, x, y) for s in scene['shapes'])
                    key = 'core' if hit and c and (x-c[0])**2+(y-c[1])**2 <= c[2]**2 else 'body' if hit else 'miss'
                    grids[key][cell] += weight/1024
        return {**grids, 'size': size, 'bounds': bounds, 'frames': self.frames, 'scenes': self.scenes,
                'sceneCount': len(self.scenes), 'spatial': all(s['spatial'] for s in self.scenes),
                'fired': sum(f['pellets'] for f in self.frames),
                'hit': sum(f['pellets']*f['hit'] for f in self.frames),
                'coreHits': sum(f['pellets']*f['hit']*f['core'] for f in self.frames)}
