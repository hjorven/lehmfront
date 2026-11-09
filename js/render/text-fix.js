// Kleine Schrift auf skaliertem Canvas. Die Karte zeichnet in Feldkoordinaten (ein Feld = 1), Schriftgroessen
// stehen dort als Bruchteil eines Feldes (z. B. 18 * px mit px = 1 / Zoom, also 0,77px bei Zoom 23). Chrome setzt
// Schrift unter etwa 2px falsch: die Laufweite rundet auf null, alle Buchstaben landen uebereinander ("MG" wird
// zu einem verschmierten Zeichen, Sichtlinien-Beschriftungen sind unlesbar).
//
// Abhilfe an einer Stelle statt in jeder Zeichenfunktion: fillText, strokeText und measureText rechnen kleine
// Schrift in Geraetepixel um, zeichnen ohne Skalierung (Drehung bleibt) und geben Masse wieder in Kartenmass
// zurueck. Grosse Schrift und unskalierte Leinwaende bleiben unberuehrt.

/** Ab dieser Groesse (in Nutzerpixeln) wird nichts umgerechnet */
export const SMALL_FONT = 4;
const SIZE_RE = /(\d*\.?\d+(?:e-?\d+)?)px/;

/** Rechnet aus, ob und wie umgerechnet wird: null oder { k, font } (rein, fuer Tests) */
export function scaledFont(font, m) {
  const k = Math.hypot(m.a, m.b);
  if (!(k > 1.01)) return null;
  const hit = SIZE_RE.exec(font ?? '');
  if (!hit) return null;
  const size = Number(hit[1]);
  if (!(size > 0) || size >= SMALL_FONT) return null;
  return { k, font: font.replace(SIZE_RE, `${size * k}px`) };
}

export function installTextFix(proto) {
  if (!proto || proto.__lfTextFix) return false;
  proto.__lfTextFix = true;
  for (const name of ['fillText', 'strokeText']) {
    const orig = proto[name];
    proto[name] = function (text, x, y, maxWidth) {
      const m = this.getTransform();
      const s = scaledFont(this.font, m);
      if (!s) return maxWidth === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, maxWidth);
      const sx = m.a * x + m.c * y + m.e, sy = m.b * x + m.d * y + m.f;
      this.save();
      this.setTransform(m.a / s.k, m.b / s.k, m.c / s.k, m.d / s.k, sx, sy);
      this.font = s.font;
      this.lineWidth *= s.k;
      if (maxWidth === undefined) orig.call(this, text, 0, 0);
      else orig.call(this, text, 0, 0, maxWidth * s.k);
      this.restore();
    };
  }
  const measure = proto.measureText;
  proto.measureText = function (text) {
    const s = scaledFont(this.font, this.getTransform());
    if (!s) return measure.call(this, text);
    const font = this.font;
    this.font = s.font;
    const big = measure.call(this, text);
    this.font = font;
    // Nur die gebraeuchlichen Masse zurueckrechnen; TextMetrics ist nicht beschreibbar
    const out = {};
    for (const key of ['width', 'actualBoundingBoxLeft', 'actualBoundingBoxRight', 'actualBoundingBoxAscent',
      'actualBoundingBoxDescent', 'fontBoundingBoxAscent', 'fontBoundingBoxDescent']) {
      if (typeof big[key] === 'number') out[key] = big[key] / s.k;
    }
    return out;
  };
  return true;
}

if (typeof CanvasRenderingContext2D !== 'undefined') installTextFix(CanvasRenderingContext2D.prototype);
