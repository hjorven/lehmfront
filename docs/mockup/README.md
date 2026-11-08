# UI-Mockup Lehmfront

- `lehmfront-ui.html`: fertig gebaut, Schriften eingebettet. Einfach im Browser öffnen. Leiste oben: Stil, Ansicht (Gefecht oder 10 Features), Tageszeit-Regler.
- `template.html`: Quelle ohne eingebettete Schriften (der Platzhalter `/*FONTS*/` wird beim Bauen ersetzt).
- `build.mjs`: bettet die Schriften aus den fontsource-Paketen ein und schreibt `lehmfront-ui.html`.
- `shoot.mjs`: Screenshots aller Stile, Features und Tageszeiten mit Playwright nach `shots/`.

```bash
npm install
npm run build
npx playwright install chromium
npm run shots
```
