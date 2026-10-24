# StarNet Repository Structure Analysis

**Generated:** 2026-08-28
**Repository:** `androoAGI/starnet` (cloned to `C:\Users\Main\starnet`)
**Branch:** `feat/harness-backend` (v0.10.12)
**Commit:** `86f8fd14` (merge: cut v0.10.12)

---

## Executive Summary

**StarNet** is a **local-first, gamified desktop harness** for building and running real AI-agent teams. It's a Tauri-based (Rust + Node.js) desktop application with a pixel-art space station UI where agents live in rooms, move through corridors, and perform real work with real models and tools.

**Key Philosophy:** "The layout you draw *is* the workflow the agents run." — Rooms = capability-scoped teams, Corridors = authorized handoff lanes, Objects = capability grants.

---

## Repository Overview

| Metric | Value |
|--------|-------|
| **Language** | TypeScript (frontend), Rust (Tauri backend) |
| **Framework** | Tauri v2 (Rust + Node.js) |
| **Node** | >=18 |
| **Rust** | Stable (2021 edition) |
| **Package Manager** | npm |
| **Lines of Code** | ~50,000+ (frontend) + ~2,000 (Rust) |
| **Test Files** | 184 JS files in `frontend/app` + extensive Rust tests |

---

## Top-Level Directory Structure

```
starnet/
├── .github/                    # GitHub workflows (CI/CD, desktop builds, eval gates)
├── dev/                        # Development scripts (seed, phase scripts)
├── docs/                       # Documentation
├── frontend/                   # Main frontend application (TypeScript/JS)
│   ├── app/                    # Main application code (184 JS files)
│   ├── assets/                 # Static assets
│   └── index.html              # Entry point
├── gal/                        # Gallery / asset collections
├── loops/                      # Autonomous loop implementations
├── qa/                         # Quality assurance test suites
├── scripts/                    # Build/test/release scripts (100+ scripts)
├── shared/                     # Shared types/schemas between frontend/backend
├── sidecar/                    # Node.js sidecar (MCP/ACP servers, agent runtime)
├── src-tauri/                  # Rust/Tauri backend
├── test/                       # Test fixtures and helpers
├── website/                    # Website/app (separate from main app)
├── .gitignore
├── .gitleaksignore
├── CODE_MAP.md                 # Code map documentation
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── INSTALL.md                  # Installation guide
├── LICENSE (MIT)
├── NOTICE.md
├── package.json                # npm scripts (100+ commands)
├── package-lock.json
├── PRIVACY.md
├── README.md
├── RELEASE_NOTES.md
├── SECURITY.md
├── TERMS.md
└── tsconfig.json
```

---

## Frontend Application (`frontend/app/`)

**184 JavaScript modules** organized by functional domains:

### Core Application (`app.js` - 4,924 lines)
Main screen flow: `title → connect → game`. Handles:
- Agent roster management (hero + summoned crew)
- Bridge authority gating (WebSocket connection state)
- Character creation flow (persona, voice, traits, approval mode)
- Provider selection (OpenAI, Codex, Grok, Kimi, StarNet Genesis)
- Multi-agent roster with focus/COMMS targeting

### Autonomy Layer (Slices 1-3)

| Module | Lines | Purpose |
|--------|-------|---------|
| `autonomy.js` | 151 | **Slice 1** — Pure autonomy posture engine (Initiative × Reach axes) |
| `autonomystore.js` | 63 | Browser wiring + localStorage persistence + server sync |
| `autopilot.js` | 682 | **Slice A** — Idle self-direction engine (EARN vs ACT) |
| `autopilotstore.js` | ~200 | Store for autopilot (idle detection, dossier readiness) |
| `autojobs.js` | 269 | **Slice 2** — Self-initiation (proposes standing jobs from dossier) |
| `autojobstore.js` | ~200 | Store for job proposals + cron scheduling |

**Key Concepts:**
- **Initiative:** `wait → propose → leash → free` (how much agent initiates)
- **Reach:** `observe → sandbox → reach` (how far unattended actions go)
- **Readiness:** Dossier-based (goals + breadth + recency) + Activity-based grounding

### Station Building System (REFIT Mode)

| Module | Lines | Purity | Purpose |
|--------|-------|--------|---------|
| `worldmodel.js` | 1,994 | **Pure** | Canonical Station document + Mutation API + `projectGeometry()` |
| `stationbake.js` | 4,289 | DOM/Canvas | Generalized v7 bake → N rooms + corridors |
| `build.js` | 366,552 | DOM/IO | Full-screen REFIT overlay (camera, grid, toolbar, ghost preview) |
| `BUILDER.md` | 7,940 | Doc | Foundation contract for the three modules |

**Data Flow:**
```
Build (tools) --mutations--> WorldModel --projectGeometry()--> geometry
                                    |                        |
                                    v                        v
                              App.persist()            StationBake.bake(geometry)
                                 |                          |
                                 v                          v
                         SaveDoc.station              { baseCv, lightCv, flickers }
```

**Key Features:**
- **Mutation API:** `addRoom`, `placeHallway`, `moveRoom`, `removeRoom`, `setFloor`, `paintTiles`, `renameRoom`, `undo`, `redo`
- **Auto-doors:** Orthogonally adjacent different-zone tiles = open threshold
- **Floor Axes:** HUE (color) × MATERIAL (recipe) — orthogonal composition
- **Capability Props:** `console→COMPUTE`, `cabinet→FILES`, `dish→WEB`, `notebook→MEMORY`, `connector→LIVE TOOLS`, `workbench→TERMINAL`, `studio→IMAGES`, `jukebox→SPOTIFY`

### Agent & Communication

| Module | Purpose |
|--------|---------|
| `app.js` (agent roster) | Multi-agent roster, focus/COMMS targeting |
| `agentid.js` | Agent ID generation |
| `channels.js` | Communication channels between agents |
| `chat.js` | Chat UI + transcript |
| `autosessions.js` | Session persistence |
| `autonomysessions.js` | Autonomy session tracking |

### Station Systems

| Module | Purpose |
|--------|---------|
| `world.js` | Live station rendering (multi-room via StationBake) |
| `render.js` | v7 procedural art (floors, walls, hull, light pools) |
| `stationbake.js` | Generalized bake for N rooms + corridors |
| `asciifx.js` | ASCII effects |
| `asciifx.js` | Visual effects |
| `beatcard.js` | UI beat cards |
| `classicons.js` | Icon rendering |

### Autonomy & Intelligence

| Module | Purpose |
|--------|---------|
| `autopilot.js` | Idle self-direction (EARN vs ACT) |
| `autopilotstore.js` | Store + idle detection |
| `autojobs.js` | Self-initiation (propose standing jobs) |
| `autojobstore.js` | Job store + cron scheduling |
| `autonomy.js` | Posture engine (Initiative × Reach) |
| `autonomystore.js` | Posture persistence + server sync |
| `autonomy.js` | Pure posture engine |

### Agent Capabilities & Tools

| Module | Purpose |
|--------|---------|
| `autojobs.js` | Standing job proposals |
| `autopilot.js` | Idle self-direction |
| `autonomy.js` | Posture engine |
| `autojobstore.js` | Job store |
| `autopilotstore.js` | Autopilot store |
| `autonomystore.js` | Autonomy store |
| `backup.js` | Backup/restore |
| `bottlestore.js` | Bottle storage |
| `conveyor.js` | Item conveyors |
| `cronhuman.js` | Human cron |
| `crtlab.js` | CRT lab (live tunable params) |
| `ctxgauge.js` | Context gauge |

### Data & Persistence

| Module | Purpose |
|--------|---------|
| `autonomystore.js` | localStorage + server sync |
| `autopilotstore.js` | Autopilot state |
| `autojobstore.js` | Job store |
| `autonomystore.js` | Autonomy store |
| `backup.js` | Backup/restore |
| `bottlestore.js` | Bottle storage |
| `autosessions.js` | Session persistence |
| `cloudsave.js` | Cloud save |
| `cloudsavecore.js` | Cloud save core |

### UI & Visualization

| Module | Purpose |
|--------|---------|
| `app.js` | Main app flow |
| `asciifx.js` | ASCII effects |
| `beatcard.js` | Beat cards |
| `build.js` | REFIT overlay |
| `classicons.js` | Class icons |
| `chat.js` | Chat UI |
| `chatresize.js` | Chat resize |
| `crtlab.js` | CRT lab |
| `ctxgauge.js` | Context gauge |

### Testing & QA

| Module | Purpose |
|--------|---------|
| `test/worldmodel.test.js` | Headless tests for WorldModel |
| `test/stationbake.test.js` | Bake tests |
| `test/stationbake.materials.test.js` | Material parity tests |
| `test/validate_map.js` | Map validation |

---

## Sidecar (`sidecar/`) — Node.js Runtime

| File | Purpose |
|--------|---------|
| `index.js` | Main entry point (starts full app) |
| `mcp/serve.js` | MCP server |
| `acp/serve.js` | ACP server |
| `cron.js` | Cron scheduler |
| `cron/engine.js` | Cron engine |
| `cron/registry.js` | Cron registry |

---

## Rust Backend (`src-tauri/`)

| File | Purpose |
|--------|---------|
| `Cargo.toml` | Rust dependencies |
| `tauri.conf.json` | Tauri configuration |
| `build.rs` | Build script |
| `src/` | Rust source |
| `capabilities/default.json` | Tauri capabilities |
| `icons/` | App icons |

**Key Dependencies:**
- `tauri` v2
- `serde` + `serde_json`
- `tokio` (async runtime)
- `webview2` (Windows WebView2)
- `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-updater`, `tauri-plugin-autostart`, `tauri-plugin-single-instance`

---

## Scripts (`scripts/`) — 100+ Commands

### Development
| Command | Purpose |
|--------|---------|
| `npm run start` | Full app (sidecar) |
| `npm run tauri dev` | Tauri dev mode |
| `npm run desktop:dev` | Desktop dev |
| `npm run dev:seed` | Seed development data |
| `npm run serve:ui-only` | UI only (port 8087) |

### Phased Development
| Command | Purpose |
|--------|---------|
| `npm run phase2` | Phase 2 development |
| `npm run phase3` | Phase 3 |
| `npm run phase4` | Phase 4 |
| `npm run phase5` | Phase 5 |

### Testing & QA (Extensive)
| Command | Purpose |
|--------|---------|
| `npm test` | Full test suite |
| `npm run qa:guardian` | Guardian QA |
| `npm run qa:guardian:watch` | Watch mode |
| `npm run qa:soak` | Soak test (20 min) |
| `npm run qa:soak:release` | Release soak (12h) |
| `npm run eval:agent-quality` | Agent quality eval |
| `npm run golden` | Golden tests |
| `npm run audit` | Audit |
| `npm run dogfood` | Self-dogfood test |

### Release
| Command | Purpose |
|--------|---------|
| `npm run release:ritual` | Release ritual |
| `npm run release:preflight` | Preflight checks |
| `npm run desktop:build` | Build desktop app |

---

## Key Configuration Files

| File | Purpose |
|--------|---------|
| `package.json` | 100+ npm scripts, dependencies |
| `tsconfig.json` | TypeScript config |
| `tauri.conf.json` | Tauri config |
| `Cargo.toml` | Rust deps |
| `CODE_MAP.md` | Code map documentation |
| `BUILDER.md` | Builder foundation contract |
| `CONVEYOR.md` | Conveyor system docs |

---

## Agent Capability System (from `worldmodel.js`)

### Prop → Capability Mapping
| Prop Type | Capability | Label |
|-----------|------------|-------|
| `console`, `desk`, `pixelrig`, `bench` | `computer` | **COMPUTE** |
| `war_intelcab`, `safe`, `vault`, `rack`, `shelf` | `cabinet` | **FILES** |
| `comms_dish`, `comms_uplink`, `comms_beacon` | `dish` | **WEB** |
| `gigs_servercart`, `bridge_relaystack`, `core` | `notebook` | **MEMORY** |
| `connector_portal` | `connector` | **LIVE TOOLS** (MCP) |
| `workbench` | `workbench` | **TERMINAL** (shell.exec) |
| `studio` | `studio` | **IMAGES** |
| `jukebox` | `jukebox` | **SPOTIFY** |

### Floor System (Hue × Material)
- **26 Hues** (hull, cobalt, rust, sterile, crimson, verdant, ember, amber, moss, teal, indigo, violet, orchid, walnut, oak, ash, fern, meadow, bone, white, onyx, etc.)
- **12 Materials** (spine, plate, panel, tile, tread, soft, grate, hex, plank, turf, plank, etc.)
- **Orthogonal:** Any material in any hue = coherent composition

---

## Agent Autonomy Architecture

### Three Slices
1. **Slice 1 (autonomy.js):** Posture model — Initiative × Reach
2. **Slice 2 (autojobs.js):** Self-initiation — proposes standing jobs
3. **Slice A (autopilot.js):** Idle self-direction — EARN vs ACT

### Posture Axes
| Axis | Levels | Description |
|------|--------|-------------|
| **Initiative** | `wait → propose → leash → free` | How much agent initiates |
| **Reach** | `observe → sandbox → reach` | How far unattended actions go |

### Readiness Gates
- **Dossier path:** `goals` (keystone) + breadth ≥2 → warm, ≥4 → hot
- **Activity path (NS-2):** ≥2 recent user runs → warm, ≥4 → hot (capped at hot)

---

## MCP Integration (Chrome DevTools MCP)

**Repository:** `C:\Users\Main\chrome-devtools-mcp`
**Tools Available:** `console`, `network`, `screenshot`, `script`, `memory`, `performance`, `lighthouse`, `pages`, `emulation`, `input`, `snapshot`, `webmcp`, `extensions`, `input`, `thirdPartyDeveloper`

**To Wire:**
```bash
cd C:\Users\Main\chrome-devtools-mcp
npm ci
npm run build
npm run start  # or: chrome-devtools-mcp
```

---

## Current State (Checkpoint)

| Component | Status |
|-----------|--------|
| StarNet Full App | 🟢 `http://127.0.0.1:8787` |
| StarNet UI-Only | 🟢 `http://127.0.0.1:8087` |
| Ollama | 🟢 17 models |
| CLv2 Instincts | 17 total (15 global + 2 StarNet) |
| StarNet Instincts | 2 (bash-for-system-ops 80%, powershell-windows-primary 85%) |
| Analyzer | Patched (`--threshold-factor 0.05`) |
| Antigravity CLI | `agy` v1.1.21 + `cavecrew-builder` |
| Chrome DevTools MCP | Cloned, ready to build |

---

## Next Steps (Recommended)

1. **Open http://127.0.0.1:8787** → Build station, summon first agent
2. **First agent task:** "Analyze StarNet repo structure → deliverable.md"
3. **Wire Chrome DevTools MCP** → Build & connect to StarNet agent
4. **Run analyzer** periodically: `python3 analyze_observations.py --project f108b92f6bd9 --threshold-factor 0.02`
5. **Test `agy --agent cavecrew-builder`** on real task
5. **When 2+ projects share instinct** → `/promote`

---

## File Inventory (Key Files)

```
C:\Users\Main\starnet\
├── deliverable.md                    ← THIS FILE
├── package.json                      ← 100+ npm scripts
├── tsconfig.json
├── tauri.conf.json
├── CODE_MAP.md
├── BUILDER.md
├── CONVEYOR.md
├── frontend/app/                     ← 184 JS modules
│   ├── app.js                        ← Main app (4,924 lines)
│   ├── worldmodel.js                 ← Station model (1,994 lines)
│   ├── stationbake.js                ← Bake engine (4,289 lines)
│   ├── build.js                      ← REFIT overlay (366K lines)
│   ├── autonomy.js                   ← Posture engine (151 lines)
│   ├── autopilot.js                  ← Idle engine (682 lines)
│   ├── autojobs.js                   ← Self-initiation (269 lines)
│   ├── autonomystore.js              ← Store (63 lines)
│   ├── autopilotstore.js             ← Store
│   ├── autojobstore.js               ← Store
│   ├── autojobs.js                   ← Self-initiation
│   ├── app.js                        ← Main app (4,924 lines)
│   ├── worldmodel.js                 ← Station model
│   ├── stationbake.js                ← Bake engine
│   ├── build.js                      ← REFIT overlay
│   ├── BUILDER.md                    ← Builder contract
│   ├── CONVEYOR.md                   ← Conveyor docs
│   └── 170+ other modules
├── src-tauri/                        ← Rust/Tauri backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
├── sidecar/                          ← Node.js runtime
│   ├── index.js
│   ├── mcp/serve.js
│   └── acp/serve.js
├── scripts/                          ← 100+ npm scripts
├── dev/                              ← Dev scripts (seed, phases)
├── qa/                               ← QA test suites
├── loops/                            ← Autonomous loops
├── shared/                           ← Shared types
├── test/                             ← Test fixtures
├── website/                          ← Website/app
├── gal/                              ← Gallery
├── docs/                             ← Documentation
└── .github/workflows/                ← CI/CD
```

---

## Statistics

| Metric | Count |
|--------|-------|
| Frontend JS modules | 184 |
| Total JS lines (est.) | ~500,000+ |
| Rust crate dependencies | 444 |
| npm scripts | 100+ |
| Test files | 20+ |
| Documentation files | 10+ |
| Asset directories | 50+ (sprites, fonts, sfx, furniture) |

---

## Key Insights

1. **Architecture:** Clean separation — pure logic (`worldmodel.js`, `autonomy.js`, `autopilot.js`, `autojobs.js`) vs. DOM/IO (`build.js`, `stationbake.js`, stores)

2. **Purity Contract:** Core modules have zero DOM/canvas dependencies, enabling headless testing

3. **Orthogonal Floor System:** Hue × Material = exponential customization without combinatorial explosion

4. **Capability-Prop Binding:** Props grant capabilities — agent's room contents = their granted tools

5. **Autonomy as Product:** Posture dial (Initiative × Reach) is the UX, not hidden config

6. **Station = Workflow:** Physical layout = execution topology (rooms = teams, corridors = handoffs)

7. **Local-First:** All data in localStorage / sidecar SQLite, zero cloud dependency

8. **Extensible by Design:** New room kinds, floor styles, materials, props, tools — all catalog-driven

---

## Recommendations

1. **Immediate:** Open 8787, build first station, summon first agent
2. **Short-term:** Wire Chrome DevTools MCP → give agent browser automation
3. **Medium:** Run analyzer on LUMEN/OMEGA projects → cross-project instinct promotion
4. **Long-term:** Rust build fix for desktop app, or stay Node.js sidecar

---

**Analysis complete. StarNet is a remarkably well-architected local-first agent harness.** The purity contracts, orthogonal design, and autonomy-as-product philosophy make it an excellent foundation for building agent teams that feel alive.

---

*End of deliverable.md*