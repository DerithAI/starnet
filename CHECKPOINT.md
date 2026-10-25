# CHECKPOINT — starnet — 2026-10-25

| Pole | Wartość |
|---|---|
| Status | HEAD to `a3b76f99d Re-lock the release surface after the line-ending normalisation`, na `fork/feat/harness-backend` (`DerithAI/starnet`). Working tree: **czyste**. |
| Gałąź zdalna | `fork/feat/harness-backend` = fork użytkownika, w którym jest v0.12.4 + brief verification tools. `origin` wskazuje na upstream autora (`androoAGI/starnet`) — tam nie ma prawa pushu, i słusznie. |
| Bramka | `npm run test:fast` — `test/fast.list` ma teraz **841 kroków** (fork dodał ~150). Ostatni pomiar: patrz „Weryfikacja". |
| Wymagany runtime | **Node 22** (jak CI). Node 24 na Windows wybucha w teardownzie libuv — patrz „Diagnoza awarii". |

## Co było zepsute i co zrobiłem

| # | Problem | Przyczyna | Naprawa |
|---|---|---|---|
| 1 | Fast gate padał na **55/689** — od 2026-09-13, ponad miesiąc | `test/checkpoint-default-on.test.js` (i ~100 innych) regexuje źródło z kotwicą `\n`. Working tree na Windows miał CRLF (`core.autocrlf=true` globalnie), więc regexy nie pasowały. Na Linuxie CI przechodziło — bramka zielona w CI, czerwona u właściciela. | `.gitattributes` z `* text=auto eol=lf` + `core.autocrlf=false` w tym repo + wymuszony full re-checkout. Bramka: 55 → 271. |
| 2 | Bramka padała na 271: `qa-product-perfect-claims.test.js` — planning BLOCKED | Ledger claims lockuje bajty plików release-surface; trzy się zmieniły. | `node scripts/qa/product-perfect/relock-surface.mjs` — re-lock do zweryfikowanego commita, **osobnym commitem** („re-locking is its own committed act"). `planning.ok = true / PASS`. |
| 3 | `npm run validate:raw` wskazywał na nieistniejący `test/validate_map.js` | Commit `086f8679` wycofał `validate` i `test:world`, ale **przeoczył** `validate:raw`, który wskazywał na ten sam plik. Nic go nie wołało. | Skrypt usunięty z `package.json`. |
| 4 | Osiem plików-śmieci po przekierowaniach shella: `0`, `1.1.0`, `For`, `None`, `str`, `}`, `part.text)`, `part.type` | Agent wykonywał komendy z `>` w środku. Wszystkie 0 bajtów. | Usunięte. |
| 5 | `frontend/app/app.js` — provider domyślny `'openai'` → `'ollama'` na sztywno | Hardcode z komentarzem „Set directly to local Ollama", omijający udokumentowany lejek BEGINNER-FIRST. | **Zachowane** — świadoma zmiana lokalna; testy providera przechodzą (`app-boot-provider-truth`, `provider-oauth-parity`, `provider.codex`, `genesis-starnet-link`). |
| 6 | `sidecar/providers/registry.js` — profil openai-compatible miał `supportsTools: null` i `order: 60` | Provider siedział na końcu listy, obsługa narzędzi nieznana. | `supportsTools: true`. **Order:60 → 1 przejął fork** — nowsza, recenzowana wersja v0.12.4. |
| 7 | Chrome discovery wskazywał na `C:/Users/andro/...` (inny użytkownik) i szukał w `Program Files` zamiast `Program Files (x86)` | Ścieżki zaszyte na maszynie autora. | Nowy porządek, **zmierzony**, nie zgadnięty: realny Chrome/Edge → Playwright headless shell → Playwright full chromium (ostatni, bo ten wychodzi natychmiast z kodem 0 przy uruchomieniu bezpośrednim). Trzy skrypty dzielą jeden `findChrome` z `scripts/lib/cdp.mjs`. |
| 8 | Wyciek procesów Chrome: 62 procesy żywe przez trzy dni testów | Crashpad-handler **celowo się odłącza** (ma przeżyć przeglądarkę, żeby zgłosić crash), więc `taskkill /T` go nie rusza; trzyma handle na `CrashpadMetrics-active.pma` i profil nie da się usunąć (EBUSY). | `killChromeForProfile()` — dociera do crashpada po ścieżce profilu. Czyszczenie katalogu tymczasowego **nie obala już wyniku testu**: ostrzega zamiast rzucać. |
| 9 | Fork wniósł **249 plików z CRLF** w indeksie | Ten sam defekt co #1, w drugiej partii plików. | Znormalizowane: 336 plików, 42354 wstawki i 42354 usunięcia, **0 zmian treści**. 17 plików „mixed" git traktuje jako binarne. |

## Weryfikacja (2026-10-25)

- `node test/checkpoint-default-on.test.js` → **OK (14 assertions)**.
- `inspectClaimsAuthority()` → `planning.ok = true / PASS`, `terminal.ok = false / BLOCKED` — dokładnie to, czego wymaga test.
- `git status --porcelain` → **0 wpisów**.
- Bramka fast: pomiar w toku po rebase na v0.12.4; **nie jest jeszcze 841/841**.

## Diagnoza awarii (dowód, nie spekulacja)

**Node 24 vs Node 22.** `sidecar.security.test.js` raportował „OK (20 assertions)", a proces wybuchał przy teardownzie: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit `3221226505` (`0xC0000409`). Pod **Node 22 — 10/10 OK**; pod Node 24 — około 50% przebiegów. Asercja siedzi w libuv `win/async.c`. Projekt dokumentuje Node 22 („matches CI"), a lokalnie był Node 24.16.0.

**Pozostały blocker po rebase:** `test/loop.parallel-tools.test.js` — „three 60ms read-only calls overlap (153ms, sequential would be >=180ms)". Test **pomiarowy**: sprawdza, że trzy wywołania 60 ms idą równolegle. Pod obciążeniem CPU (równoległe przebiegi) równoległość nie zachodzi i test pada. Do decyzji, czy to defekt, czy test wrażliwy na obciążenie.

## NIE RUSZAĆ

- `sidecar/` — „Single Hotfile": `sidecar/index.js` (~6.5k linii) to plik z największą liczbą konfliktów przy merge'ach; trzymać zmiany minimalne.
- `shared/` — „FROZEN contract (additive only)": `shared/events.js` i `shared/schema.js`; nigdy nie zmieniaj/usuwaj nazw eventów/pól bez zatwierdzonej migracji.
- `qa/product-perfect/claims.json` — ledger claims. Re-locking zmienia `releaseSurface` (bajty i ścieżki) i **musi** być osobnym commitem. Inwentarz claims i werdykty są recenzowane ręcznie — nie ruszać.
- `package.json` — skrypt `validate:raw` **nie istnieje** i nie wraca: `test/validate_map.js` został wycofany w `086f8679`.

## Następna akcja

1. Bramka fast do 841/841 na Node 22, na maszynie bez obciążenia.
2. `test/loop.parallel-tools.test.js` — rozstrzygnąć: pomiarowy test czy defekt.
3. `npm test` (fast + http) — bramka PR-owa.

## Kto i kiedy

- claude-code (Sonnet 5), 2026-09-13T11:54:50Z — diagnoza blokera CRLF/LF, bez naprawy
- opencode (MiniMax M3.1 Flash), 2026-10-24/25 — naprawa blokera CRLF/LF, cleanup, re-lock ledgeru, Chrome discovery, kill crashpada, rebase na v0.12.4, normalizacja 249 plików forku
