# Kampagne und Feldzugskarte (P14)

Plan 2.4, 2.6, 3.1, 4.3, Stil 09 (Kriegsraum). Szene: `index.html?scene=feldzug`.
Beispielstände ohne Speichern: `&demo=mitte|tief|hoch|ende`, dazu `&stempel=umdeuten` und `&bericht=lattenroste`.

## Ablauf

1. Neuer Feldzug: `newCampaign` (js/campaign.js), Prolog der Erzählung (P15), dann die Feldzugskarte.
2. Auf der Karte liegt der Stabsbefehl der nächsten Mission. Stempel: **Befolgen** (volle Folgen), **Umdeuten**
   (sofort Ansehen −1, Vertrauen +2, danach halbe Folgen), **Verweigern** (sofort Ansehen −(|verfehlt|+2), bei EILT
   noch −2, Vertrauen +4, danach keine Folgen). Verweigern muss zweimal getippt werden, ebenso jeder Stempel, der das
   Ansehen unter 10 drückt (der Hinweis sagt dann „Damit werden Sie abgelöst“). Hat die Mission eine eigene
   Entscheidung mit befolgen/umdeuten/verweigern (a3m4 ...), wird nur der Eingang bestätigt.
3. „Zum Einsatz“ speichert die Kampagne und öffnet `?scene=gefecht&scenario=<id>&campaign=1&seed=<n>`.
   `js/ui/campaign/mission.js` legt Ansehen, Vertrauen, Berichte, Nachschub, Batteriemunition und Ersatz auf den
   Startzustand (`applyCampaignToState`) und zeigt „Einsatz melden“. Meuterei (Vertrauen unter 10, Phase `campaign`)
   oder ein angemeldetes Missionsziel beenden den Einsatz von selbst; der Dialog kommt erst nach dem Phasenfilm
   (`afterRound` merkt vor, `afterFilm` zeigt). Ohne laufenden Einsatz leitet `campaign=1` zur Feldzugskarte um.
4. Zurück auf der Feldzugskarte: `finishMission` bucht alle Auslöser, zählt die Erfahrungsberichte, verschiebt die
   Front, dann `playInterlude` (Gefallenenliste, Post, Entscheidungen, nächstes Briefing), dann `afterInterlude`.
5. Unter 10 Ansehen: abgelöst, unter 10 Vertrauen: Meuterei. Beides beendet den Feldzug mit den Texten
   `ende.vorzeitig.*` aus `data/texts/enden.json`.

## Für die Missionspakete (P16 ff.)

```js
// js/config/missions.js: Szenario je Mission eintragen
export const MISSION_SCENARIOS = { a1m1: 'akt1-m1', ... };

// Missionsziel anmelden (in einer Datei, die das Gefecht ohnehin lädt)
import { registerMissionJudge } from './js/campaign.js';
registerMissionJudge('a1m1', ({ state, rounds, side, counts }) =>
  counts.lost === 0 && state.turn > 6 ? { outcome: 'sieg', orderMet: true, why: 'Linie steht' } : null); // null: läuft weiter
```

Ohne Ziel gilt beim Melden: verloren bei Meuterei, mehr verlorenem als gewonnenem Graben oder Meldung vor
`HOLD_ROUNDS` (6) Runden ohne Geländegewinn, sonst Sieg.
`state.result` (P13, `ctx.finish`) wird übernommen. Flags einer Mission (`harms_gefallen`, `velde_verloren` ...)
gibt das Missionsziel im Ergebnis mit (`{ outcome, orderMet, why, flags: ['harms_gefallen'] }`); `finishMission`
setzt sie vor der Zwischenszene, damit Gefallenenliste, Tagebuch und Briefe sie lesen.

## Ansehen und Vertrauen (Plan 2.6)

| Auslöser | Achse | Wert je Mission |
|---|---|---|
| Stabsbefehl erfüllt / verfehlt | Ansehen | `folgen` aus den Texten, umgedeutet halb, verweigert nichts |
| Gegenstoß befohlen / versäumt (P06) | Ansehen | Veränderung im Spielzustand |
| Grabenfelder genommen / verloren | Ansehen | +1 je Feld (höchstens +6) / −1 je Feld mal Fraktionsfaktor (höchstens −8) |
| Gefangene | Ansehen | +1 je 2 (höchstens +4) |
| Ablösung, zu lange vorn, liegen gelassene Verwundete (P08, P12) | Vertrauen | Veränderung im Spielzustand |
| Warme Mahlzeiten | Vertrauen | +1 je 4 (höchstens +3) |
| Feldpost | Vertrauen | +1 je Runde mit Post (höchstens +2) |
| Verwundete zurückgebracht | Vertrauen | +1 je 4 (höchstens +4) |
| Angriff mit geringen Verlusten | Vertrauen | +2 je Angriff (höchstens +4) |
| Hohe Verluste | Vertrauen | −1 je 3 Ausfälle über 4, mal Fraktionsfaktor (höchstens −10) |
| Sturm, der mehr als die Hälfte kostete | Vertrauen | −3 je Sturm (höchstens −6) |
| Entscheidungen, Waffenruhe | beide | `folgen` der Option (P15) |

Wirkung: Nachschub je Runde 60 bis 140 Prozent, Ersatz vor dem Einsatz (ab Ansehen 18), Batteriemunition
(unter 25 halb, ab 75 ein Viertel mehr), Erfahrungsberichte bleiben unter 25 beim Stab liegen. Vertrauen:
Moralerholung (zwischen 40 und 60 neutral), Grabgeschwindigkeit (P04), unter 25 in Akt 4 Verweigerung (Regel in P26,
`state.sides[s].campaign.refuse`).

## Erfahrungsberichte

20 Berichte in `js/config/reports.js`, Texte in `data/texts/berichte.json`. Zähler laufen über alle Missionen.
Im Spiel stehen sie als `state.sides[s].reports`. `hasReport` (Bonus) und `reportOpen` (Sperre nur in der Kampagne).
Schon wirksam: Faschinenbau (Grabenstufe 3), Lattenroste (Entwässern), Feuerwalze, Drahtscheren (Schützen schneiden),
Stahlhelme (Splitter), Grabenkeulen (Nahkampf), Sanitätsloren. Die übrigen zählen schon und warten auf ihre Mechanik.
