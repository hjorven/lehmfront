# Klang-Engine (Paket K1)

Alles wird zur Laufzeit mit WebAudio erzeugt, es gibt keine Aufnahmen. Demo: `index.html?scene=klang`.

## Einbinden

```js
import { audio, playSfx, setAmbience, setVolume } from './audio/engine.js';

audio.init();                       // lauscht auf das erste Tippen/Taste, erst dann entsteht der AudioContext
playSfx('stamp');                   // vor dem ersten Tippen: still, Rueckgabe false; im ersten Tippen selbst klingt er schon
playSfx('rifle', { x: 42, width: 60, intensity: 0.4 });   // x relativ zur Kartenbreite -> Stereo
playSfx('teletype', { count: 12, bell: true });           // Fernschreiber-Zeile mit Glocke (STOP)
setAmbience({ darkness: 0.8, rain: 0.3, wind: 0.2, battle: 0.1 });  // teilweise Angaben sind ok
setVolume('music', 0.3);            // Busse: master, music, sfx, ambience; Werte 0..1, werden gespeichert
audio.startMusic(); audio.stopMusic(); audio.stopAmbience(); audio.stopAll();
audio.setMusicBattle(0.8);          // nur Musik zurueckziehen, wenn keine Umgebung laeuft
audio.setMuted(true); audio.setOption('shellshock', false);
audio.onChange((state) => { /* fuer Einstellungen und Anzeigen */ });
```

## Klaenge (`playSfx`-Namen)

| Name | Klang | Optionen ausser x, width, pan, intensity, delay |
|---|---|---|
| `paper` | Papier rascheln | |
| `pencil` | Bleistift kratzen | `count` Striche |
| `stamp` | Stempel | |
| `teletype` | Fernschreiber-Anschlag | `count` Anschlaege, `bell` |
| `tick` | Uhr ticken | `tock` fuer den tieferen Schlag |
| `clock-lock` | Uhr rastet ein | |
| `artillery-far` | ferne Artillerie | |
| `impact-near` | naher Einschlag, ab intensity 0,55 taub | `incoming: false` ohne Anflug |
| `mg-far` | MG-Salve in der Ferne | |
| `rifle` | Gewehrschuss | |
| `whistle` | Pfeife zum Sturm | |
| `flare` | Leuchtkugel | |
| `rain`, `wind` | Regen- bzw. Windboe als Einzelklang | |
| `lore` | Lore faehrt vorbei (Stereo-Wanderung) | |
| `steps` | Schlamm-Schritte | `count` |

Die Umgebung nutzt zusaetzlich `crow`, `cricket`, `drip` und nach nahem Einschlag `tinnitus`.

## Aufbau

- `logic.js`: reine Funktionen (Ueberblend-Kurven, Parameter, Pegel der Umgebung, Ereignisraten, Musikphrasen, Taubheitskurve). Getestet in `test/audio.test.js`.
- `sounds.js`: jeder Klang als Funktion `(ac, out, p, t, rng) -> { end }`. Jede Huelle beginnt und endet bei 0, jede Quelle hat ein festes `stop()`.
- `ambience.js`: Dauerschichten (Grollen der Front, Regen, Wind) plus verstreute Einzelklaenge nach Rate.
- `music.js`: Bordun und wenige Harmonium-Toene in D-Aeolisch, viel Stille.
- `engine.js`: Busse, Lautstaerke, Stumm, Ducking im Hintergrund-Tab, Takt (laeuft nur, solange Umgebung oder Musik an sind).

Signalweg: `sfx`, `ambience`, `music` -> Gehoer (Tiefpass) -> `master` -> Ducking -> Begrenzer -> Ausgang.
Der nahe Einschlag selbst und das Ohrensausen laufen am Gehoer vorbei.

Nach einer Unterbrechung (iOS-Anruf, Hintergrund) lauscht die Engine wieder auf eine Geste und setzt beim Zurueckkehren in den Tab fort.

## Klang im Spiel (Paket P19)

- `cues.js` (rein, getestet in `test/cues.test.js`): welches Ereignis wie klingt, Kappung (hoechstens 5 Klaenge je Schwung, 2 gleiche), Stereo nach `at.x`, Grundton der Front `ambienceFor({ darkness, weather, kind, log, side })`.
- `director.js`: spielt ab. `cueEvents(events, { side, state })`, `cueSection(key)`, `frontAmbience({ state, darkness, log, side })`, `hushFront()`, `paperHooks(extra)` fuer die Papierebene.
- Eingehaengt: Phasenfilm (`js/ui/film.js`, neue Telegrammzeilen klingen nur beim Abspielen, nicht beim Scrubbing; Uhrphase tickt), Gefecht (Grundton nach Tageszeit, Wetter und letzter Runde, Pfeife beim Sturm nach dem Halten-Ring, Musik), Papier (Anschlag, Glocke, Stempel, Rascheln), Etappe (Bauen, Reparieren, Belohnung, neue Runde mit Lore).
- Regler: `js/ui/sound.js` (`mountSoundControls({ bar, sheet })` fuer Knopf plus Handy-Karte, `soundPanel()` fuer das Einstellungsmenue aus P18).

### Ereignis-Haken fuer neue Mechanik

Ein Paket mit neuen Ereignissen meldet den Klang in seinem eigenen Modul an, ohne `cues.js` zu aendern:

```js
import { registerCue, shellCue } from '../audio/cues.js';
registerCue('wire_cut', (e, ctx) => [{ name: 'pencil', opts: { count: 2, intensity: 0.4 } }]);
registerCue('barrage', (e, ctx) => shellCue(e, ctx, 0.7));   // nah an eigenen Gruppen: naher Einschlag mit Taubheit
```

`ctx = { side, width, own }`. Rueckgabe: Liste `{ name, opts?, delay? }` mit einem Klang aus der Tabelle oben oder `'hush'`. Vorbelegt sind schon `assault`, `artillery`, `barrage`, `shell`, `shelling`, `impact`, `mine`, `flare`, `supply`, `cart`, `lore`, `carts_arrived`, `weather`; wer andere Namen nimmt, meldet sie an oder ersetzt die Vorbelegung. Phasen bleiben rein: `registerCue` gehoert in eine Datei unter `js/ui/` oder `js/audio/`, nicht in `js/phases/*` (dort sind nur reine Regeln erlaubt). Damit die Anmeldung geladen wird, die Datei dort importieren, wo das Paket ohnehin sein Werkzeug oder Overlay anmeldet (z. B. `js/ui/tools/<name>.js`).
