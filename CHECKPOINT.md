# CHECKPOINT — starnet — 2026-10-25

| Pole | Wartość |
|---|---|
| Status | HEAD to `d69612912 One Chrome-profile teardown for every browser test`, na `fork/feat/harness-backend` (`DerithAI/starnet`). Working tree: **czyste**. |
| Gałąź zdalna | `fork/feat/harness-backend` = fork użytkownika, w którym jest v0.12.4 + brief verification tools. `origin` wskazuje na upstream autora (`androoAGI/starnet`) — tam nie ma prawa pushu, i słusznie. |
| Bramka | `npm run test:fast` — `test/fast.list` ma **841 kroków** (fork dodał ~150 do dawnych 689). Ostatni pomiar: **817/841**. |
| Wymagany runtime | **Node 22** (jak CI). Node 24 na Windows wybucha w teardownzie libuv — patrz „Diagnoza awarii". |

## Co było zepsute i co zrobiłem

| # | Problem | Przyczyna | Naprawa |
|---|---|---|---|
| 1 | Fast gate padał na **55/689** — od 2026-09-13, ponad miesiąc | `test/checkpoint-default-on.test.js` (i ~100 innych) regexuje źródło z kotwicą `\n`. Working tree na Windows miał CRLF (`core.autocrlf=true` globalnie), więc regexy nie pasowały. Na Linuxie CI przechodziło — bramka zielona w CI, czerwona u właściciela. | `.gitattributes` z `* text=auto eol=lf` + `core.autocrlf=false` + wymuszony full re-checkout. Bramka: 55 → 271. |
| 2 | Bramka padała na 271: `qa-product-perfect-claims.test.js` — planning BLOCKED | Ledger claims lockuje bajty plików release-surface; trzy się zmieniły. | `node scripts/qa/product-perfect/relock-surface.mjs` — re-lock do zweryfikowanego commita, **osobnym commitem**. `planning.ok = true / PASS`. |
| 3 | `npm run validate:raw` wskazywał na nieistniejący `test/validate_map.js` | Commit `086f8679` wycofał `validate` i `test:world`, ale **przeoczył** `validate:raw`. Nic go nie wołało. | Skrypt usunięty z `package.json`. |
| 4 | Osiem plików-śmieci po przekierowaniach shella: `0`, `1.1.0`, `For`, `None`, `str`, `}`, `part.text)`, `part.type` | Agent wykonywał komendy z `>` w środku. Wszystkie 0 bajtów. | Usunięte. |
| 5 | `frontend/app/app.js` — provider domyślny `'openai'` → `'ollama'` na sztywno | Hardcode omijający udokumentowany lejek BEGINNER-FIRST. | **Zachowane** — świadoma zmiana lokalna; testy providera przechodzą. |
| 6 | Chrome discovery wskazywał na `C:/Users/andro/...` i szukał w `Program Files` zamiast `Program Files (x86)` | Ścieżki zaszyte na maszynie autora. | Nowy porządek, **zmierzony**: realny Chrome/Edge → Playwright headless shell → Playwright full chromium (ostatni, bo ten wychodzi natychmiast z kodem 0 przy uruchomieniu bezpośrednim). Trzy skrypty dzielą jeden `findChrome`. |
| 7 | **DZIURA**: `detectRoot` szukał korzenia projektu 40 poziomów w górę po `.git` — i trafiał na **katalog domowy** (tu `C:\Users\Main` **jest** repo git). Proponował błogosławienie całego home = read/write nad wszystkimi plikami użytkownika. | Brak granicy. | Walk staje na katalogu domowym; nigdy go nie proponuje i nie idzie wyżej. Moduł bierze `home` jako dep, sidecar podaje prawdziwy, test wstrzykuje swój (maszynowo niezależny). |
| 8 | Wyciek procesów Chrome: 27 procesów żywych, 3 profile zablokowane | Crashpad-handler **celowo się odłącza** (ma przeżyć przeglądarkę, żeby zgłosić crash), więc `taskkill /T` go nie rusza i trzyma handle na profilu. Do tego helper `killChromeForProfile` **nigdy nie działał** — podwajał backslashe, a PowerShell `-like` traktuje backslash jak zwykły znak. | Jeden helper `cleanupChromeProfile()` dla wszystkich testów przeglądarkowych: kill drzewa, crashpad po ścieżce profilu, ponowienie, zablokowany profil = ostrzeżenie nie porażka. Zmierzone na żywym procesie: ścieżka pojedynczym backslashem → 8 trafień, podwojona → 0. |
| 9 | Fork wniósł **249 plików z CRLF** w indeksie | Ten sam defekt co #1, w drugiej partii plików. | Znormalizowane: 336 plików, 42354 wstawki i 42354 usunięcia, **0 zmian treści**. |
| 10 | Strona `website/app/app/app.js` rozjechała się z `frontend/app/app.js` | Moja zmiana providera nie trafiła do lustra. | `npm run sync:website` — narzędzie repo do tego. 1 plik, 1 linia. |
| 11 | `test/projection-depth-rendering.test.js` — `MODULE_NOT_FOUND: @napi-rs/canvas` | Zależność **jest** zadeklarowana (`0.1.100`), ale `node_modules` to stara, częściowa instalacja (40 pakietów). | `npm ci` — pełna instalacja z lockfile. |

## Weryfikacja (2026-10-25)

- `node test/checkpoint-default-on.test.js` → **OK (14 assertions)**.
- `inspectClaimsAuthority()` → `planning.ok = true / PASS`, `terminal.ok = false / BLOCKED`.
- `pathtrust.test.js` → **OK (58 assertions)**; `e2e.pathtrust.test.js` → **OK (52)**.
- `failopen-ratchet.test.js` → **OK (156 assertions)** — budżet fail-open dla `pathtrust.js` bez zmian (2).
- `worldlight-receiver` / `stationbake.connections` (408 asercji Canvas) / `world-sharpen` (33 przypadki WebGL, 13635 próbek RGB, max błąd 1/255) → **wszystkie OK, zero wyciekłych procesów**.
- `git status --porcelain` → **0 wpisów**.

## Diagnoza awarii (dowód, nie spekulacja)

**Node 24 vs Node 22.** `sidecar.security.test.js` raportował „OK (20 assertions)", a proces wybuchał przy teardownzie: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, exit `3221226505` (`0xC0000409`). Pod **Node 22 — 10/10 OK**; pod Node 24 — około 50% przebiegów. Asercja siedzi w libuv `win/async.c`. Projekt dokumentuje Node 22 („matches CI").

**Obciążenie maszyny udawało defekt.** Wyciekłe procesy Chrome zjadały CPU do 100%. Pod obciążeniem test pomiarowy `loop.parallel-tools.test.js` („trzy wywołania 60 ms mają iść równolegle") padał, choć kod był poprawny. Na czystej maszynie przechodzi. To one, nie kod, powodowały te „flaky" błędy.

**`0xC0000409` w `LUMEN_MEGA_PLATFORM`** okazał się środowiskowy, nie defektem platformy: 60 kolejnych uruchomień `main.py --reflect` przeszło bez crasha.

## NIE RUSZAĆ

- `sidecar/` — „Single Hotfile": `sidecar/index.js` to plik z największą liczbą konfliktów przy merge'ach; trzymać zmiany minimalne.
- `shared/` — „FROZEN contract (additive only)": `shared/events.js` i `shared/schema.js`; nigdy nie zmieniaj/usuwaj nazw eventów/pól bez zatwierdzonej migracji.
- `qa/product-perfect/claims.json` — ledger claims. Re-locking zmienia `releaseSurface` i **musi** być osobnym commitem. Inwentarz claims i werdykty są recenzowane ręcznie — nie ruszać.
- `package.json` — skrypt `validate:raw` **nie istnieje** i nie wraca: `test/validate_map.js` został wycofany w `086f8679`.
- `website/app/` — **lustrzane** z `frontend/`. Zmiana w frontendzie bez `npm run sync:website` rozjechała bramkę na kroku 459/841.

## Następna akcja

1. Bramka fast do 841/841 — zostało 24 kroków po ostatnim pomiarze (817/841).
2. `npm test` (fast + http) — bramka PR-owa.

## Kto i kiedy

- claude-code (Sonnet 5), 2026-09-13T11:54:50Z — diagnoza blokera CRLF/LF, bez naprawy
- opencode (MiniMax M3.1 Flash), 2026-10-24/25 — naprawa blokera CRLF/LF, cleanup, re-lock ledgeru, Chrome discovery, kill crashpada, rebase na v0.12.4, normalizacja 249 plików forku, dziura w detectRoot, wspólny teardown profilu Chrome
