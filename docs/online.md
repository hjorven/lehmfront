# Lehmfront online (P20)

Online ist seit 2026-11-09 geschaltet: Supabase-Projekt `lehmfront` (Ref `trxetnkronmurxqcrhit`,
eu-central-1, Org "Jorven", Free-Tarif), eingetragen in `js/config/online.js`. Ohne Eintrag zeigt das
Fernsprechamt "Leitung nicht geschaltet", alles Offline bleibt unverändert. Der Replay-Link braucht keinen
Server und geht immer. Für das zweite freie Projekt wurde Flussreich pausiert.

## Teile

| Teil | Datei |
|---|---|
| Schema mit RLS | `supabase/migrations/0001_init.sql` |
| Beitreten per Code | `supabase/functions/join/index.ts` |
| Runde rechnen (beide da oder Frist um) | `supabase/functions/resolve/index.ts` |
| Tageslage nachrechnen und eintragen | `supabase/functions/submit-daily/index.ts` |
| Gemeinsames der Functions (CORS, Anmeldung) | `supabase/functions/_lib/http.ts` |
| Spiellogik für die Functions (auf einen Commit gepinnt) | `supabase/functions/_lib/logic.ts` |
| Reine Logik (Server und Client) | `js/online/replay.js`, `js/online/match.js` |
| Client | `js/net.js` (supabase-js als UMD aus `vendor/`), Szene `?scene=fernamt` |
| Lageaustausch (Werkstatt) | Tabelle `lagen` aus `supabase/migrations/0002_lagen.sql`, Client `shareLage`, `listLagen`, `getLage`, `deleteLage` in `js/net.js` |
| Replay-Link | `js/online/link.js`, im Gefecht `wiedergabe=1` mit Protokoll im Anker `#w=` |

## Einrichten (einmal)

1. Supabase-Projekt `lehmfront` anlegen (Region eu-central-1). Im Free-Tarif sind zwei aktive Projekte je
   Besitzer erlaubt (erledigt, Ref `trxetnkronmurxqcrhit`).
2. Migration anwenden: Inhalt von `supabase/migrations/0001_init.sql` (Supabase-MCP `apply_migration`
   oder SQL-Editor oder `supabase db push`).
3. Authentication: anonyme Anmeldung einschalten (Dashboard, Authentication, Sign In / Providers,
   "Allow anonymous sign-ins"). Site URL `https://hjorven.github.io/lehmfront/`, Redirect-URL zusätzlich
   `https://hjorven.github.io/lehmfront/?scene=fernamt`.
4. Functions deployen:
   ```bash
   supabase functions deploy join resolve submit-daily --project-ref trxetnkronmurxqcrhit --no-verify-jwt
   ```
   Ohne CLI über den Supabase-MCP (`deploy_edge_function`, `verify_jwt: false`): die Dateiliste je Function
   liefert `node tools/sync-functions.mjs --mcp join` (Einstieg `index.ts`, drei Dateien).
   `verify_jwt` ist aus, weil die Functions die Anmeldung selbst prüfen (`auth.getUser` in `_lib/http.ts`)
   und das Projekt ES256-Tokens ausgibt.
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

Die Functions laden die reinen Module des Spiels (`js/online/match.js`, `js/online/replay.js` und alles,
was sie importieren) über jsDelivr von GitHub, fest auf einen Commit gepinnt; Supabase bündelt sie beim
Deploy. GitHub Pages ist nach jedem Merge live, die Functions nicht. Nach einer Änderung an Regeln oder KI,
die Online-Partien oder die Tageslage betrifft, nach dem Merge:

```bash
git fetch origin main
node tools/sync-functions.mjs --pin "$(git rev-parse origin/main)"
supabase functions deploy join resolve submit-daily --project-ref trxetnkronmurxqcrhit --no-verify-jwt
```

Den neuen Pin danach mit einem kleinen PR einchecken. Laufende Partien rechnen ab dann mit den neuen Regeln
weiter; ihr Replay-Link nutzt die Regeln der Seite, kann also nach großen Regeländerungen abweichen.
`node tools/sync-functions.mjs` ohne Argument zeigt den gepinnten Stand.

## Lageaustausch (seit 1.6.0)

Migrationen `0002_lagen.sql` und `0003_lagen_haerten.sql` sind eingespielt (2026-11-09, Management-API; 0003: Anlegen nur mit title, author, code, Code nur base64url). Keine Edge Function nötig: Lesen
darf jeder, Anlegen und Löschen nur der Verfasser (RLS), Ändern niemand, höchstens 20 Lagen je Spieler
(Trigger). Der Server prüft nur Form und Größe des Codes; ob eine Lage spielbar ist, prüft der Client mit
`lageProblems` vor dem Spielen und Öffnen. Titel und Verfasser ohne `<>&"`.
Durchstich mit zwei anonymen Probekonten geprüft: anlegen, ohne Anmeldung lesen, Ändern 403, fremdes
Löschen wirkungslos, ohne Anmeldung kein Anlegen, kaputter Code und Titel mit spitzen Klammern 400.

Authentication (Stand 2026-11-09): anonyme Anmeldung an, Site URL `https://hjorven.github.io/lehmfront/`,
Redirect-URLs `https://hjorven.github.io/lehmfront/?scene=fernamt` und `https://hjorven.github.io/lehmfront/**`.

## Geprüft am 2026-11-09

Durchstich gegen das echte Projekt (zwei Probe-Konten): Partie anlegen (RLS), Beitreten per Code (`join`),
`match_states` für Spieler gesperrt, eigene Sicht lesbar, Seed bis zum Ende leer, Befehle für eine falsche
Runde abgewiesen, fremde Befehle nicht lesbar, `lf_turn_status` zeigt nur abgegeben ja/nein, `resolve`
wartet bis beide da sind und rechnet dann genau einmal (zweiter Aufruf: wartet auf Runde 2),
`submit-daily` weist eine unfertige Woche und einen abgelaufenen Tag mit deutscher Begründung ab.

Security-Advisors: nur gewollte Hinweise (RLS ohne Policy auf `match_states` und `daily_orders`,
`lf_open_invites` und `lf_turn_status` als security definer für angemeldete Spieler ausführbar).

Die CI-Browserprüfung ruft Fernsprechamt und Tageslage mit `&online=aus` auf, damit sie nicht gegen den
echten Dienst läuft.

## Fristen

Stellungsrunde 48 Stunden, Gefechtsrunde 12 Stunden. Ist die Frist um, kann jede Seite die Runde rechnen
lassen (Knopf im Gefecht); wer nichts geschickt hat, hält, begonnene Wege laufen weiter. Eine Partie endet
nach 14 Stellungsrunden (wie die Tageslage) oder wenn eine Seite keine Gruppe mehr hat.
