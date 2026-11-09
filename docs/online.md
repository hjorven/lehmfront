# Lehmfront online (P20)

Der Online-Teil ist fertig gebaut, aber erst aktiv, wenn ein Supabase-Projekt eingerichtet und in
`js/config/online.js` eingetragen ist. Ohne Eintrag zeigt das Fernsprechamt "Leitung nicht geschaltet",
alles Offline bleibt unverändert. Der Replay-Link braucht keinen Server und geht immer.

## Teile

| Teil | Datei |
|---|---|
| Schema mit RLS | `supabase/migrations/0001_init.sql` |
| Beitreten per Code | `supabase/functions/join/index.ts` |
| Runde rechnen (beide da oder Frist um) | `supabase/functions/resolve/index.ts` |
| Tageslage nachrechnen und eintragen | `supabase/functions/submit-daily/index.ts` |
| Spiellogik für die Functions (Kopie, nicht eingecheckt) | `supabase/functions/_shared/` aus `node tools/sync-functions.mjs` |
| Reine Logik (Server und Client) | `js/online/replay.js`, `js/online/match.js` |
| Client | `js/net.js` (supabase-js als UMD aus `vendor/`), Szene `?scene=fernamt` |
| Replay-Link | `js/online/link.js`, im Gefecht `wiedergabe=1` mit Protokoll im Anker `#w=` |

## Einrichten (einmal)

1. Supabase-Projekt `lehmfront` anlegen (Region eu-central-1). Im Free-Tarif sind zwei aktive Projekte je
   Besitzer erlaubt; am 2026-11-09 war das Limit erreicht (Flussreich, Poly-battle-web).
2. Migration anwenden: Inhalt von `supabase/migrations/0001_init.sql` (Supabase-MCP `apply_migration`
   oder SQL-Editor oder `supabase db push`).
3. Authentication: anonyme Anmeldung einschalten (Dashboard, Authentication, Sign In / Providers,
   "Allow anonymous sign-ins"). Site URL `https://hjorven.github.io/lehmfront/`, Redirect-URL zusätzlich
   `https://hjorven.github.io/lehmfront/?scene=fernamt`.
4. Functions deployen:
   ```bash
   node tools/sync-functions.mjs
   supabase functions deploy join resolve submit-daily --project-ref <ref>
   ```
   Ohne CLI über den Supabase-MCP (`deploy_edge_function`, `verify_jwt: true`): die Dateiliste je Function
   liefert `node tools/sync-functions.mjs --mcp join` (Einstieg `index.ts`).
5. `js/config/online.js`: `url` und den Publishable Key (`sb_publishable_...`) oder den alten anon Key
   eintragen. Nie den Service-Role- oder Secret-Key; ein Test prüft das.
6. Advisors prüfen (Security und Performance).

Zum Ausprobieren mit einem eigenen Projekt ohne Commit im Browser:
`localStorage.setItem('lehmfront.online', JSON.stringify({ url: 'https://<ref>.supabase.co', key: 'sb_publishable_...' }))`.

## Verdeckter Zustand

- Voller Zustand und Seed nur in `match_states` (keine Policy, keine Rechte für anon/authenticated).
- Jeder Spieler liest nur seine Sicht in `match_views` (gefiltert mit `viewFor`).
- Fremde Befehle sind erst nach dem Ende lesbar. Mit Seed, Startlage und den Befehlen beider Seiten ließe
  sich der volle Zustand im Browser nachrechnen; darum wird auch der Seed erst am Ende in `matches.seed`
  geschrieben, zusammen mit dem Protokoll in `matches.record` für den Replay-Link.
- Wartende Partien sieht nur ihr Anleger; Beitreten nur mit Code über `join`.
- Die Tageslage-Bestenliste zeigt Punkte, die Befehle liegen in `daily_orders` ohne Policy.
- Der Startzustand (Namen und Heimatorte der Gruppenführer) kommt aus einem öffentlichen Seed aus der
  Partie-ID (`initSeedFor`), alle Würfe der Runden aus dem geheimen Seed. Sonst ließe sich der geheime Seed
  aus den eigenen Namen in Sekunden zurückrechnen. Der Replay-Link trägt beide (`seed`, `iseed`).
- `lf_turn_status` verrät nur, ob die Gegenseite für die laufende Runde abgegeben hat.

## Nach Regeländerungen

Die Functions rechnen mit ihrer eigenen Kopie der Spiellogik. GitHub Pages ist nach jedem Merge live, die
Functions nicht: nach jeder Änderung an Regeln oder KI `node tools/sync-functions.mjs` und neu deployen.

## Fristen

Stellungsrunde 48 Stunden, Gefechtsrunde 12 Stunden. Ist die Frist um, kann jede Seite die Runde rechnen
lassen (Knopf im Gefecht); wer nichts geschickt hat, hält, begonnene Wege laufen weiter. Eine Partie endet
nach 14 Stellungsrunden (wie die Tageslage) oder wenn eine Seite keine Gruppe mehr hat.
