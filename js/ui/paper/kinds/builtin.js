// Die eingebauten Blattarten der Papierebene. Datenformat siehe js/ui/paper/README.md.
// Jede Art liefert { front, back? }. Text in [[...]] wird als Zensur geschwaerzt (Brief, Tagebuch).
import { registerKind, el } from '../registry.js';
import { artCanvas } from '../art.js';
import { parseCensored, hasCensored } from '../layout.js';

const paras = (body) => (Array.isArray(body) ? body : String(body ?? '').split(/\n\s*\n/)).filter((p) => String(p).trim());

function censored(text) {
  const parts = parseCensored(text);
  if (!parts.some((p) => p.censored)) return document.createTextNode(String(text));
  const frag = document.createDocumentFragment();
  for (const p of parts) {
    if (!p.censored) {
      frag.append(p.text);
      continue;
    }
    // Ein Balken pro Wort, so breit wie das Wort; der Text selbst steht nicht im DOM.
    // Zwischen den Woertern normale Leerzeichen, damit lange Schwaerzungen umbrechen koennen.
    const words = p.text.split(/\s+/).filter(Boolean);
    if (/^\s/.test(p.text)) frag.append(' ');
    words.forEach((w, i) => {
      const bar = el('span', 'paper-censor');
      // Das Leerzeichen gehoert mit in den Balken: durchgehend schwarz, aber umbrechbar
      bar.textContent = ' '.repeat(Math.max(2, w.length)) + (i < words.length - 1 ? ' ' : '');
      bar.setAttribute('aria-hidden', 'true');
      frag.append(bar);
    });
    frag.append(el('span', 'paper-sr', '[geschwärzt]'));
    if (/\s$/.test(p.text)) frag.append(' ');
  }
  return frag;
}

function stamp(text, cls = '') {
  return el('div', 'paper-stamp ' + cls, text);
}

// ---------- Brief ----------
registerKind('letter', {
  label: 'Brief',
  render(d) {
    const body = paras(d.body);
    const front = el('div', 'paper-letter-body', [
      d.place || d.date ? el('p', 'paper-letter-date', [d.place, d.date].filter(Boolean).join(', ')) : null,
      d.salutation ? el('p', 'paper-letter-salutation', d.salutation) : null,
      ...body.map((p) => el('p', null, censored(p))),
      d.closing ? el('p', 'paper-letter-closing', d.closing) : null,
      d.signature ? el('p', 'paper-letter-signature', d.signature) : null,
    ]);
    // Vermerk unter abgefangenen Briefen (Schreibmaschine), P15
    if (d.note) front.append(el('div', 'paper-letter-note', [d.noteTitle ? el('b', null, d.noteTitle) : null, ...paras(d.note).map((p) => el('p', null, p))]));
    if (d.crooked) front.classList.add('is-crooked');
    // Flecken nach Wetter und Tageszeit beim Schreiben (Liste wie ['wasser', 'wachs']), P15
    if (d.stains && d.stains.length) {
      const c = artCanvas('stain:' + d.stains.join('+'), d.seed ?? d.id, 310, 620, null);
      c.classList.add('paper-art-stain');
      c.removeAttribute('role');
      c.setAttribute('aria-hidden', 'true');
      front.prepend(c);
    }
    const censoredAny = body.some(hasCensored);
    if (censoredAny || d.examined) front.append(stamp(d.examinedBy || 'Geprüft · Feldpostprüfstelle 3', 'paper-stamp-round'));
    return { front, title: d.title || (d.signature ? 'Brief von ' + d.signature : 'Brief') };
  },
});

// ---------- Telegramm und Stabsbefehl (Stil 03) ----------
registerKind('telegram', {
  label: 'Telegramm',
  render(d) {
    const head = el('div', 'paper-tele-head', [
      el('b', null, d.heading || 'TELEGRAMM'),
      d.number ? el('span', null, ' · Nr. ' + d.number) : null,
    ]);
    const form = (rows, cls) =>
      rows && rows.length
        ? el('dl', 'paper-form ' + (cls || ''), rows.map(([k, val]) => el('div', null, [el('dt', null, k + ':'), el('dd', null, val)])))
        : null;
    const lines = (d.lines || []).map((t) => {
      const line = el('div', 'paper-tele-line');
      line.dataset.text = String(t);
      line.textContent = String(t);
      return line;
    });
    const front = el('div', 'paper-tele-body', [
      head,
      form(d.fields, 'paper-form-top'),
      el('div', 'paper-tele-text', lines),
      form(d.footer, 'paper-form-foot'),
    ]);
    if (d.urgent) front.append(stamp(d.urgentText || 'EILT', 'paper-stamp-urgent'));
    return { front, typedLines: lines, title: (d.heading || 'Telegramm') + (d.number ? ' Nr. ' + d.number : '') };
  },
});

// ---------- Tagebuchseite (Aquarell, Stil 06) ----------
registerKind('diary', {
  label: 'Tagebuch',
  render(d) {
    const front = el('div', 'paper-diary-body', [
      el('div', 'paper-diary-head', [el('span', 'paper-diary-date', d.date || ''), d.title ? el('span', 'paper-diary-title', d.title) : null]),
      d.sketch !== false ? artCanvas('wash:' + (d.sketch || 'huegel'), d.seed ?? d.id, 280, 110, 'Aquarellskizze') : null,
      ...paras(d.body).map((p) => el('p', null, censored(p))),
      d.signature ? el('p', 'paper-diary-sign', d.signature) : null,
    ]);
    return { front, title: 'Tagebuch ' + (d.date || '') };
  },
});

// ---------- Gefallenenliste (Schreibmaschine, Formular) ----------
registerKind('casualties', {
  label: 'Gefallenenliste',
  render(d) {
    const rows = (d.entries || []).map((e) =>
      el('tr', null, [el('td', null, e.name), el('td', null, e.group ?? ''), el('td', 'num', e.turn ?? ''), el('td', null, e.cause ?? '')]),
    );
    const table = el('table', 'paper-list', [
      el('thead', null, el('tr', null, ['Name', 'Gruppe', 'Runde', 'Ursache'].map((h) => el('th', h === 'Runde' ? 'num' : null, h)))),
      el('tbody', null, rows),
    ]);
    const front = el('div', 'paper-cas-body', [
      el('div', 'paper-cas-head', [el('b', null, d.title || 'Gefallenenliste'), el('span', null, d.form || 'Formblatt V 12')]),
      el('dl', 'paper-form paper-form-top', [
        el('div', null, [el('dt', null, 'Abschnitt:'), el('dd', null, d.sector || '')]),
        el('div', null, [el('dt', null, 'Einsatz:'), el('dd', null, d.mission || '')]),
        el('div', null, [el('dt', null, 'Datum:'), el('dd', null, d.date || '')]),
        el('div', null, [el('dt', null, 'Anzahl:'), el('dd', null, String(rows.length))]),
      ]),
      table,
      d.note ? el('p', 'paper-cas-note', d.note) : null,
      el('div', 'paper-cas-sign', [el('span', null, 'Gez.'), el('span', 'paper-cas-signline', d.signedBy || '')]),
    ]);
    return { front, title: (d.title || 'Gefallenenliste') + (d.mission ? ', ' + d.mission : '') };
  },
});

// ---------- Zeitung (Stil 10) ----------
registerKind('newspaper', {
  label: 'Zeitung',
  render(d) {
    const cols = paras(d.columns).map((p) => el('p', null, censored(p)));
    const front = el('div', 'paper-news-body', [
      el('div', 'paper-news-mast', d.masthead || 'Kalderner Bote'),
      el('div', 'paper-news-meta', [el('span', null, d.date || ''), el('span', null, d.issue || ''), el('span', null, d.price || '')]),
      el('h3', 'paper-news-headline', d.headline || ''),
      d.subhead ? el('p', 'paper-news-sub', d.subhead) : null,
      d.picture !== false ? artCanvas('press', d.seed ?? d.id, 300, 92, d.pictureCaption || 'Pressefoto') : null,
      d.pictureCaption ? el('p', 'paper-news-caption', d.pictureCaption) : null,
      el('div', 'paper-news-cols', cols),
    ]);
    // Bleistiftnotiz eines Lesers an der Front, schraeg ueber den Satzspiegel (T2, Plan 7.8 Stil 10)
    if (d.margin) front.append(el('p', 'paper-news-margin', d.margin));
    return { front, title: (d.masthead || 'Zeitung') + ' ' + (d.date || '') };
  },
});

// ---------- Fundstueck-Foto, mit beschrifteter Rueckseite ----------
registerKind('photo', {
  label: 'Fundstück',
  render(d) {
    const front = el('div', 'paper-photo-body', [
      artCanvas((d.motif === 'karte' ? 'flur' : d.motif === 'postkarte' ? 'postcard' : 'photo:' + (d.motif || 'graben')), d.seed ?? d.id, 220, 160, d.alt || d.caption || 'Foto'),
      d.caption ? el('p', 'paper-photo-caption', d.caption) : null,
    ]);
    let back = null;
    if (d.back) {
      back = el('div', 'paper-photo-back', [
        el('p', 'paper-photo-backtext', d.back),
        el('p', 'paper-photo-print', d.printer || 'Atelier Wessel · Lichtbild · Nachdruck verboten'),
      ]);
    }
    return { front, back, title: 'Fundstück' + (d.caption ? ': ' + d.caption : '') };
  },
});

// ---------- Aktkarte (Linolschnitt, Stil 08) ----------
registerKind('actcard', {
  label: 'Aktkarte',
  render(d) {
    const front = el('div', 'paper-act-body', [
      artCanvas('lino:' + (d.motif || 'sonne'), d.seed ?? d.id, 280, 170, d.title || 'Aktbild'),
      el('div', 'paper-act-label', d.act || 'Akt'),
      el('h3', 'paper-act-title', d.title || ''),
      d.subtitle ? el('p', 'paper-act-sub', d.subtitle) : null,
      d.text ? el('p', 'paper-act-text', d.text) : null,
    ]);
    return { front, title: (d.act || 'Akt') + ': ' + (d.title || '') };
  },
});
