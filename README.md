# Frostbound

A mobile-first, open-world creature-combat game that runs as a pure static site (no build step). You play **Glacira**, a seal-penguin hybrid with ice powers, exploring a procedurally generated Antarctica:

- **Iceberg Fields** — snowy island with icebergs, crystals and checkpoint totems. Home of the swarming **Snowmite** and the ground-slamming **Crag Walrus**.
- **Polar Sea** — swim between ice floes. Watch for the circling **Eelstorm** and the bubble-spitting **Krillcloud**.
- **Leviathan Deep** — far north-east (purple ring on the minimap) lurks the mini-boss, the **Aurora Leviathan**.

Defeat creatures for XP; each level adds max HP and damage. Level/XP are saved in `localStorage`. If you fall, you revive at the last glowing ice totem you touched.

All creatures, names and art are original; everything is drawn from Three.js primitives and sounds are synthesized with WebAudio.

## Controls

| Action | Touch (landscape) | Keyboard |
|---|---|---|
| Move | Drag anywhere on the left half (floating joystick) | WASD / arrows |
| Orbit camera | Drag empty space on the right half | Q / E |
| Bite (3-hit combo, 3rd is heavy) | 🦷 button (hold to repeat) | J |
| Ice Shard (homing projectile) | 💠 | K |
| Tidal Dash (invulnerable dash) | 🌊 | L |
| Frost Nova (AoE, slows) | ❄️ | Space |
| Pause | II button | P / Esc |

Attacks auto-aim at the highlighted (ringed) enemy. Red circles on the ground are attack telegraphs — dash out of them.

## Run locally

Any static server works (ES modules need http, not `file://`):

```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy on GitHub Pages

1. Merge/push these files to the `main` branch (the game lives at the repo root; `.nojekyll` is included).
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Choose **Branch: `main`**, folder **`/ (root)`**, then **Save**.
4. After a minute the game is live at **https://markosugc.github.io/Pokemon-Open-World-Game/**

On iPhone, open the URL in Safari and rotate to landscape. For full screen: Share → **Add to Home Screen**.

## Code map

- `index.html` — HUD/title markup, import map pinning `three@0.160.0` from jsDelivr.
- `style.css` — HUD, touch controls, safe-area handling.
- `game.js` — one ES module, in banner-commented sections: `[CORE]`, `[WORLD]`, `[PLAYER]`, `[INPUT]`, `[COMBAT]`, `[SEA]`, `[BOSS/FX]`.
  - New zone: extend `rawHeight()` and `zoneAt()`.
  - New creature: add a row to `TYPES` (stats + `build()`), then `addSpawns('key', count, placementFilter)`.
