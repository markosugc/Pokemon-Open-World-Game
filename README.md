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
| Bite (3-hit combo, 3rd is heavy) | 🦷 (hold to repeat) | J |
| Glacier Slam | 🦷 while high in the air | J in the air |
| Ice Shard (homing projectile) | 💠 | K |
| Tidal Dash (1 stamina, invulnerable, works in air) | 🌊 | L / Shift |
| Frost Nova (AoE, slows) | ❄️ | I |
| Jump / double jump / wall jump | ⤴️ | Space |
| Dive / surface (deep water only) | 🤿 | F |
| Creature Almanac + morphing | 📖 | M |
| Pause | II | P / Esc |

Attacks auto-aim at the ringed enemy. Red circles on the ground are attack telegraphs — dash out of them.

### Movement

Movement is momentum-based. The three green pips are **stamina**: a dash or a double jump costs one, and they refill over time.

- **Dash-jump**: jump during or right after a dash to carry the speed through the air.
- **Slide**: after a dash you keep sliding for a moment before friction returns.
- **Air dash / double jump**: both work mid-air; touching an iceberg in the air gives a free **wall jump**.
- **Glacier Slam**: press Bite high in the air to plunge and hit everything around the landing point.
- **Diving**: in deep water the Dive button appears. Underwater you have a breath bar; it refills at the surface.

### Creature Almanac and morphing

The 📖 button opens the almanac. Creatures appear once you meet them; defeat one to unlock its form, then tap **Morph** to play as it. Each form changes your stats (for example the Crag Walrus takes half damage, the Krillcloud fires three shards). Discoveries and unlocked forms are saved.

### Things to find

- 12 **Aurora Shards** (cyan dots on the minimap).
- A second, hidden boss — the **Frost Hydra** — that can only be reached by diving. The minimap gives a hint.
- More secrets on the island, on the floes and on the sea bed. A day/night cycle brings out stars and a brighter aurora.

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
- `game.js` — one ES module, in banner-commented sections: `[CORE]`, `[WORLD]`, `[PLAYER]`, `[INPUT]`, `[COMBAT]`, `[SEA]`, `[BOSS/FX]`, `[EXPLORE]`, `[HD CREATURES]`, `[MORPH + ALMANAC]`, `[DEPTHS + SURPRISES]`.
  - `[EXPLORE]`: 12 collectible **Aurora Shards** (cyan minimap dots) — XP + full heal each; find all for boosted energy regen. Tidal Dash damages enemies it passes through; kills refund HP/energy. Surfaces use procedural canvas textures.
  - New zone: extend `rawHeight()` and `zoneAt()`.
  - New creature: add a row to `TYPES` (stats + `build()`), then `addSpawns('key', count, placementFilter)`; add a `FORMS` entry and an `ALM` row to make it morphable and listed in the almanac.
