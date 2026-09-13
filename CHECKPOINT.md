# CHECKPOINT — starnet — 2026-09-13

| Pole | Wartość |
|---|---|
| Status | HEAD to `86f8fd14 merge: cut v0.10.12` (`git log -1 --oneline`); working tree jest BRUDNE — `git status --porcelain` pokazuje 3 zmodyfikowane pliki (`frontend/app/app.js`, `sidecar/providers/registry.js`, `src-tauri/Cargo.toml`) i kilkanaście nieśledzonych plików/artefaktów (m.in. `brain/`, `deliverable.md`, `sidecar/noetic_bridge.js`, oraz podejrzane jednoznakowe/nazwane-jak-fragment-shell śmieci: `0`, `1.1.0`, `For`, `None`, `str`, `}`, `part.text)`, `part.type` — wygląda na resztki przerwanej/rozlanej komendy, nie na celowe pliki). Nikt nie sprzątał tego przed tym checkpointem. |
| Ostatnio zweryfikowane | `npm run test:fast` (uruchomione 2026-09-13, node_modules już były zainstalowane, `npm ci` nie było potrzebne) — **FAIL**. Test wykonał 55/689 kroków poprawnie (schema, contract, events-contract, clock-rng, context, runtimeinfo, harness-snapshot, station-inspect, diagnostics*, reflect, memcore, cost/spend/ledger/budget, concurrency, workspace-*, agent-lifecycle, durable-store, domain-store, provider-runtime, run-execution-state, tool-progress-guard, tool-dispatch-boundary, completion-evidence, task-postconditions*, connector-readback, recipe-drift, recovery-policy, tool-recovery, run-journal-disk-boundary, todo.durability, halt, readbody, file-response, test-list-runner, runroute, checkpoint), po czym przerwał na kroku 56/689: `FAIL: index.js defines checkpointsEnabledFromEnv` w `test/checkpoint-default-on.test.js:12` z `TypeError: Cannot read properties of null (reading '0')`. Ostateczna linia runnera: `run-fast-tests: FAILED at step 56/689: node test/checkpoint-default-on.test.js (exit 1)`. |

## Diagnoza awarii (dowód, nie spekulacja)
`test/checkpoint-default-on.test.js` wyciąga ciało funkcji `checkpointsEnabledFromEnv` z `sidecar/index.js` regexem `/function checkpointsEnabledFromEnv\(raw\) \{[\s\S]*?\n\}\n/` zakładającym zakończenia linii LF (`\n`). Zweryfikowano bajtowo (`python3` odczyt binarny), że `sidecar/index.js` na tej maszynie ma zakończenia linii **CRLF** (`\r\n}\r\n` zamiast `\n}\n`), więc regex nigdy nie dopasowuje — `m` jest `null`, stąd `m[0]` rzuca `TypeError`. To wygląda na platformowy problem (checkout na Windows z CRLF), a nie regresję wprowadzoną tą sesją — nie dotknięto `sidecar/index.js` w ramach Taska 6 (jedyne zmiany tej sesji: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CHECKPOINT.md`).

## NIE RUSZAĆ
- `sidecar/` — udokumentowane w `AGENTS.md` jako "Single Hotfile": `sidecar/index.js` (~6.5k linii) to plik z największą liczbą konfliktów przy merge'ach; trzymać zmiany minimalne.
- `shared/` — udokumentowane w `AGENTS.md` jako "FROZEN contract (additive only)": `shared/events.js` (~60 typów eventów) i `shared/schema.js` to kontrakty tylko-dodawaj; nigdy nie zmieniaj/usuwaj nazw eventów/pól bez zatwierdzonej migracji.

## Następna akcja
Napraw failujący fast-test gate: `test/checkpoint-default-on.test.js` nie dopasowuje `checkpointsEnabledFromEnv` w `sidecar/index.js` przez niezgodność CRLF/LF w regexie na linii 10 tego testu — albo znormalizuj zakończenia linii pliku `sidecar/index.js` do LF (sprawdź `.gitattributes`/`core.autocrlf`), albo popraw regex testu żeby tolerował `\r?\n`, po czym uruchom ponownie `npm run test:fast` i potwierdź 689/689.

## Kto i kiedy
claude-code (Sonnet 5), 2026-09-13T11:54:50Z
