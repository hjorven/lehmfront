// Replay-Link (P20, Plan 9): Seed und Befehlsprotokoll stecken im Anker der Adresse (#w=...), kein Server noetig.
// Der Anker geht beim Aufruf nicht an den Webserver. Gepackt mit deflate-raw, wo der Browser das kann.
import { bytesToB64url, b64urlToBytes, checkRecord } from './replay.js';

const HAS_CS = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Protokoll -> Ankertext ("z" + gepackt oder "j" + JSON) */
export async function packRecord(rec) {
  const raw = new TextEncoder().encode(JSON.stringify(rec));
  if (HAS_CS) {
    try { return 'z' + bytesToB64url(await pipe(raw, new CompressionStream('deflate-raw'))); } catch { /* weiter ungepackt */ }
  }
  return 'j' + bytesToB64url(raw);
}

/** Ankertext -> geprueftes Protokoll oder null */
export async function unpackRecord(text) {
  try {
    const kind = text[0];
    let bytes = b64urlToBytes(text.slice(1));
    if (kind === 'z') {
      if (!HAS_CS) return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (kind !== 'j') return null;
    if (bytes.length > 2_000_000) return null;
    return checkRecord(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** Vollstaendiger Link: Gefecht mit Seed und wiedergabe=1, Protokoll im Anker */
export async function replayUrl(rec, base = location.origin + location.pathname) {
  const q = new URLSearchParams(rec.q);
  q.set('scene', 'gefecht');
  q.set('seed', String(rec.s));
  q.set('wiedergabe', '1');
  for (const k of ['slot', 'demo', 'match']) q.delete(k);
  return `${base}?${q.toString()}#w=${await packRecord(rec)}`;
}

/** Protokoll aus dem Anker der aktuellen Adresse (oder null) */
export async function recordFromHash(hash = location.hash) {
  const m = /[#&]w=([A-Za-z0-9_-]+)/.exec(hash || '');
  return m ? unpackRecord(m[1]) : null;
}
