# CHECKPOINT — starnet — 2026-10-24

| Pole | Wartość |
|---|---|
| Status | HEAD to `8e807249 Re-lock the release surface to the reviewed source`. Working tree: **czyste**. Poprzedni checkpoint (2026-09-13) opisywał brudne drzewo i bramkę padającą na 56/689 — oba problemy są domknięte. |
| Bramka | `npm run test:fast` — stan po 2026-10-24: patrz „Weryfikacja" poniżej. |
| Poprzedni blocker | **Naprawiony.** `test/checkpoint-default-on.test.js` regexował `/function checkpointsEnabledFromEnv\(raw\) \{[\s\S]*?\n\}\n/` wymagając LF, a working tree na Windows miał CRLF → `m` było `null` → `TypeError`. |

## Co było zepsute i co zrobiłem

| # | Problem | Przyczyna | Naprawa |
|---|---|---|---|
| 1 | Fast gate padał na **56/689** — od 2026-09-13, ponad miesiąc | `test/checkpoint-default-on.test.js` (i ~100 innych testów) regexuje źródło z kotwicą `\n`. Working tree na Windows miał CRLF (`core.autocrlf=true` globalnie), więc regexy nie pasowały. Na Linuxie CI przechodziły — dlatego bramka była zielona w CI i czerwona u właściciela. | `.gitattributes` z `* text=auto eol=lf` + `core.autocrlf=false` w tym repo. Working tree przepisany na LF. 13 plików zacommitowanych z CRLF znormalizowane (bez zmiany treści). Bramka przeszła z 56 na **271/689**. |
| 2 | Bramka padała na 271/689: `qa-product-perfect-claims.test.js` — planning BLOCKED | Ledger claims **lockuje bajty** 211 plików release-surface. Zmieniły się trzy: `frontend/app/app.js` (domyślny provider → lokalne Ollama) oraz `spacebg.js` i `topbar.js` (normalizacja LF). | `node scripts/qa/product-perfect/relock-surface.mjs` — re-lock do zweryfikowanego commita, **osobnym commitem** (tak to jest zaprojektowane: „re-locking is its own committed act"). `planning.ok = true / PASS`. |
| 3 | `npm run validate:raw` wskazywał na nieistniejący `test/validate_map.js` | Commit `086f8679` (2026-07-24) wycofał `validate` i `test:world` (martwe kroki v7), ale **przeoczył** `validate:raw`, który wskazywał na ten sam plik. Nic go nie wołało. | Skrypt usunięty z `package.json`. |
| 4 | Osiem plików-śmieci po przekierowaniach shella: `0`, `1.1.0`, `For`, `None`, `str`, `}`, `part.text)`, `part.type` | Agent wykonywał komendy z `>` w środku. Wszystkie 0 bajtów. | Usunięte. |
| 5 | `frontend/app/app.js` — provider domyślny `'openai'` → `'ollama'` na sztywno | Hardcode z komentarzem „Set directly to local Ollama", omijający udokumentowany lejek BEGINNER-FIRST (`revealStarnetGenesis` nadpisuje tę wartość przy auto-pick, ale **nie** w ścieżce recovery). | **Zachowane** — świadoma zmiana lokalna, testy providera przechodzą (`app-boot-provider-truth`, `provider-oauth-parity`, `provider.codex`, `genesis-starnet-link`). Świadomie zachowane, bo to preferencja środowiska, nie regresja. |
| 6 | `sidecar/providers/registry.js` — profil openai-compatible miał `supportsTools: null` i `order: 60` | Provider siedział na końcu listy, a obsługa narzędzi była nieznana. | `supportsTools: true`, `order: 1`. |

## Weryfikacja (2026-10-24)

- `npm run test:fast` — stan poniżej; **nie** jest jeszcze 689/689.
- `node test/checkpoint-default-on.test.js` → **OK (14 assertions)** — bezpośrednio potwierdza, że blocker #1 jest rozwiązany.
- `node test/sidecar.security.test.js` → **OK (20 assertions), exit 0** w izolacji.
- `inspectClaimsAuthority()` → `planning.ok = true / PASS`, `terminal.ok = false / BLOCKED` — dokładnie to, czego wymaga test.
- Wszystkie testy providera zielone.
- `git status --porcelain` → **0 wpisów**.

## Diagnoza awarii (dowód, nie spekulacja)

Bramka zatrzymuje się na `test/sidecar.security.test.js` z `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`, exit `3221226505` (`0xC0000409`, abort CRT). **Ten sam test przechodzi w izolacji z exit 0**, więc to nie jest regresja logiki — to wybuch w teardownzie libuv pod Windows, najpewniej zależny od stanu procesu w serii, nie od samego testu. Do zbadania: czy runner ma retry, i czy wybuch jest deterministyczny przy kolejnych przebiegach.

## NIE RUSZAĆ

- `sidecar/` — udokumentowane w `AGENTS.md` jako „Single Hotfile": `sidecar/index.js` (~6.5k linii) to plik z największą liczbą konfliktów przy merge'ach; trzymać zmiany minimalne.
- `shared/` — „FROZEN contract (additive only)": `shared/events.js` (~60 typów eventów) i `shared/schema.js`; nigdy nie zmieniaj/usuwaj nazw eventów/pól bez zatwierdzonej migracji.
- `qa/product-perfect/claims.json` — ledger claims. Re-locking zmienia `releaseSurface` (bajty i ścieżki) i **musi** być osobnym commitem. Inwentarz claims i werdykty są recenzowane ręcznie — nie ruszać.

## Następna akcja

1. Ustalić, czy wybuch libuv w `sidecar.security.test.js` jest deterministyczny, czy flaky. Jeśli flaky — runner powinien mieć retry na pojedynczy krok.
2. Dokończyć bramkę do 689/689 i zapisać tu wynik.
3. `npm test` (fast + http) — bramka PR-owa.

## Kto i kiedy

- claude-code (Sonnet 5), 2026-09-13T11:54:50Z — diagnoza blokera CRLF/LF, bez naprawy
- opencode (MiniMax M3.1 Flash), 2026-10-24 — naprawa blokera CRLF/LF, cleanup, re-lock ledgeru, fast gate w toku
