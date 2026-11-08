# Lehmfront: Stand

Jeder Thread traegt hier nach dem Merge ein, was fertig ist und was offen bleibt.

## Fertig

- P00 Grundgeruest: Ordnerstruktur, Titelbild, Schriften lokal, `js/rng.js`, `js/rules.js` mit Tests, Screenshot- und Pruefwerkzeug (`tools/shot.mjs`), CI mit Tests und Browser-Pruefung, GitHub Pages baut direkt aus `main` (Wurzel, `.nojekyll`).

## Offen und bekannte Macken

- (noch keine)

## Freigaben und Entscheidungen von Jorven

Stand 2026-11-08, von Jorven bestaetigt:

- Threads duerfen selbst nach `main` mergen und Einstellungen aendern, soweit GitHub es zulaesst.
- Umfang: **alle Stufen und alle Akte** (Release 1.0 bis 1.5, Akte 1 bis 4). Fertig ist das Spiel erst mit P27.
- Supabase: ein Thread darf ein Projekt fuer Lehmfront anlegen und Tabellen sowie Edge Functions deployen (Paket P20). Hinweis: Jorvens Supabase-Organisation hat schon zwei aktive Gratis-Projekte; braucht ein neues Projekt eine Bezahl-Bestaetigung, muss der Thread Jorven fragen und solange offline weiterarbeiten.
- Threads duerfen vom Plan abweichen, wenn es das Spiel besser oder ueberraschender macht. Begruendung hier unter "Abweichungen vom Plan".
- Klang wird prozedural erzeugt (WebAudio).
- Alle Spieltexte schreiben Claude-Threads selbst, gebuendelt in den Text-Threads T1 und T2.
- Bis zu 15 Threads gleichzeitig.

## Abweichungen vom Plan

- Pages baut direkt aus `main` statt ueber einen eigenen Deploy-Job (war im Repo schon so eingestellt).
