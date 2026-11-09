// Online-Anbindung (P20, Plan 11): Anmeldung, Cloud-Spielstand, Tageslage-Bestenliste, asynchrone Gefechte.
// supabase-js liegt als UMD unter vendor/ und wird erst geladen, wenn etwas online passieren soll.
// Jede Funktion liefert { ok, why?, ... } und wirft nicht: ohne Netz, ohne Projekt oder bei Fehlern bleibt das
// Spiel offline voll spielbar. Begruendungen sind deutsch und duerfen so angezeigt werden.
import { ONLINE, SUPABASE_UMD } from './config/online.js';

const LS_KEY = 'lehmfront.online';
let clientP = null;

/** Verbindungsdaten: aus js/config/online.js oder (zum Ausprobieren) aus dem localStorage; null = aus */
export function onlineConfig() {
  try {
    if (new URLSearchParams(location.search).get('online') === 'aus') return null;
  } catch { /* ohne location */ }
  let cfg = ONLINE;
  try {
    const own = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (own && typeof own.url === 'string' && typeof own.key === 'string') cfg = own;
  } catch { /* ohne Speicher */ }
  if (!cfg?.url || !cfg?.key || !/^https:\/\/[a-z0-9.-]+$/i.test(cfg.url)) return null;
  // Nie mit einem geheimen Schluessel im Browser arbeiten
  if (/^sb_secret_/.test(cfg.key) || /service_role/.test(atobSafe(cfg.key.split('.')[1] ?? ''))) return null;
  return cfg;
}

function atobSafe(s) {
  try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; }
}

/** Ist der Online-Modus eingerichtet? (sagt nichts darueber, ob gerade Netz da ist) */
export function onlineEnabled() {
  return !!onlineConfig();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.supabase?.createClient) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Bibliothek nicht ladbar'));
    document.head.append(s);
  });
}

/** Supabase-Client (einmal je Seite) oder null */
export async function client() {
  const cfg = onlineConfig();
  if (!cfg) return null;
  if (!clientP) {
    clientP = loadScript(SUPABASE_UMD)
      .then(() => window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lehmfront.auth' },
      }))
      .catch((e) => { clientP = null; throw e; });
  }
  return clientP;
}

const OFF = { ok: false, why: 'Die Leitung zum Stab ist nicht geschaltet.' };
const NET = 'Keine Verbindung. Später noch einmal.';

/** Fehlertext fuer den Spieler */
function why(error) {
  const m = String(error?.message ?? error ?? '');
  if (/fetch|network|Failed|offline/i.test(m)) return NET;
  if (/JWT|session|not authenticated/i.test(m)) return 'Bitte zuerst anmelden.';
  return m ? `Der Stab meldet: ${m}` : NET;
}

async function withClient(fn) {
  let sb;
  try { sb = await client(); } catch { return { ok: false, why: NET }; }
  if (!sb) return OFF;
  try { return await fn(sb); } catch (e) { return { ok: false, why: why(e) }; }
}

/** Antwort einer Edge Function auswerten (Fehlertexte kommen deutsch vom Server) */
async function invoke(sb, name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = null;
    try { msg = (await error.context?.json?.())?.why ?? null; } catch { /* kein JSON */ }
    return { ok: false, why: msg ?? why(error) };
  }
  return data?.ok === false ? { ok: false, why: data.why ?? NET } : { ok: true, ...data };
}

// ---------- Anmeldung ----------

/** Angemeldeter Nutzer: { ok, user: { id, anonymous, email } | null } */
export function currentUser() {
  return withClient(async (sb) => {
    const { data } = await sb.auth.getSession();
    const u = data?.session?.user ?? null;
    return { ok: true, user: u ? { id: u.id, anonymous: !!u.is_anonymous, email: u.email ?? null } : null };
  });
}

/** Anonym anmelden (muss im Projekt erlaubt sein) */
export function signInAnon() {
  return withClient(async (sb) => {
    const { error } = await sb.auth.signInAnonymously();
    return error ? { ok: false, why: why(error) } : { ok: true };
  });
}

/** Magic Link an eine Adresse schicken; der Link fuehrt zurueck ins Fernsprechamt */
export function signInEmail(email) {
  return withClient(async (sb) => {
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl() } });
    return error ? { ok: false, why: why(error) } : { ok: true };
  });
}

/** Anonymes Konto mit E-Mail sichern (dann auch auf anderen Geraeten per Magic Link) */
export function linkEmail(email) {
  return withClient(async (sb) => {
    const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: returnUrl() });
    return error ? { ok: false, why: why(error) } : { ok: true };
  });
}

export function signOut() {
  return withClient(async (sb) => {
    await sb.auth.signOut();
    return { ok: true };
  });
}

function returnUrl() {
  return location.origin + location.pathname + '?scene=fernamt';
}

/** Anmelden, falls noch niemand angemeldet ist (anonym) */
export async function ensureUser() {
  const cur = await currentUser();
  if (!cur.ok) return cur;
  if (cur.user) return cur;
  const s = await signInAnon();
  if (!s.ok) return s;
  return currentUser();
}

// ---------- Profil ----------

export function myProfile() {
  return withClient(async (sb) => {
    const { data: s } = await sb.auth.getSession();
    const id = s?.session?.user?.id;
    if (!id) return { ok: false, why: 'Bitte zuerst anmelden.' };
    const { data, error } = await sb.from('profiles').select('id, username, code').eq('id', id).maybeSingle();
    if (error) return { ok: false, why: why(error) };
    return { ok: true, profile: data };
  });
}

export function setUsername(name) {
  const clean = String(name ?? '').trim().replace(/[<>&"]/g, '').slice(0, 20);
  if (clean.length < 3) return Promise.resolve({ ok: false, why: 'Der Name braucht mindestens drei Zeichen.' });
  return withClient(async (sb) => {
    const { data: s } = await sb.auth.getSession();
    const id = s?.session?.user?.id;
    if (!id) return { ok: false, why: 'Bitte zuerst anmelden.' };
    const { error } = await sb.from('profiles').update({ username: clean }).eq('id', id);
    if (error) return { ok: false, why: /duplicate|unique/i.test(error.message) ? 'Diesen Namen führt schon jemand.' : why(error) };
    return { ok: true, username: clean };
  });
}

// ---------- Cloud-Spielstand ----------

/** Cloud-Slots: [{ slot, label, updated_at, version }] */
export function cloudList() {
  return withClient(async (sb) => {
    const { data, error } = await sb.from('saves').select('slot, label, version, updated_at').order('slot');
    return error ? { ok: false, why: why(error) } : { ok: true, saves: data ?? [] };
  });
}

/** Spielstand (Umschlag aus js/save.js) in einen Cloud-Slot 1..5 legen */
export function cloudPut(slot, envelope, label = '') {
  return withClient(async (sb) => {
    const { data: s } = await sb.auth.getSession();
    if (!s?.session) return { ok: false, why: 'Bitte zuerst anmelden.' };
    const row = { slot, data: envelope, version: envelope?.version ?? 1, label: String(label).slice(0, 80), updated_at: new Date().toISOString() };
    const { error } = await sb.from('saves').upsert(row);
    return error ? { ok: false, why: why(error) } : { ok: true };
  });
}

export function cloudGet(slot) {
  return withClient(async (sb) => {
    const { data, error } = await sb.from('saves').select('data, label, updated_at').eq('slot', slot).maybeSingle();
    if (error) return { ok: false, why: why(error) };
    return data ? { ok: true, envelope: data.data, label: data.label, updatedAt: data.updated_at } : { ok: false, why: 'Diese Kartentasche ist leer.' };
  });
}

// ---------- Lageaustausch (Werkstatt) ----------

const LAGEN_OFF = 'Der Lageaustausch ist beim Stab noch nicht eingerichtet.';
const lagenWhy = (error) => {
  const m = String(error?.message ?? '');
  if (/does not exist|schema cache/i.test(m)) return LAGEN_OFF;
  if (/Höchstens 20/.test(m)) return m;
  if (/check constraint|violates/i.test(m)) return 'Der Stab nimmt diese Lage nicht an (Titel oder Code ungültig).';
  return why(error);
};
const cleanText = (t, n) => String(t ?? '').replace(/[<>&"]/g, '').trim().slice(0, n);
// Eigene Lagen merkt sich der Browser (user_id ist im Netz nicht lesbar)
const MINE_KEY = 'lehmfront.lagen.eigene';
const readMine = () => { try { const v = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeMine = (list) => { try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(-40))); } catch { /* ohne Speicher */ } };

/** Lage (Code aus js/modes/lage-code.js) ins Netz stellen; liefert { ok, id } */
export async function shareLage(code, title, author = '') {
  if (!/^L1\.[A-Za-z0-9_-]+$/.test(String(code ?? ''))) return { ok: false, why: 'Das ist kein Lage-Code.' };
  const u = await ensureUser();
  if (!u.ok) return u;
  return withClient(async (sb) => {
    const row = { code, title: cleanText(title, 60) || 'Ohne Titel', author: cleanText(author, 30) || null };
    const { data, error } = await sb.from('lagen').insert(row).select('id').single();
    if (error) return { ok: false, why: lagenWhy(error) };
    writeMine([...readMine().filter((x) => x !== data.id), data.id]);
    return { ok: true, id: data.id };
  });
}

/** Neueste Lagen aus dem Netz: [{ id, title, author, created_at, mine }] */
export function listLagen(limit = 20) {
  return withClient(async (sb) => {
    const mine = new Set(readMine());
    const { data, error } = await sb.from('lagen').select('id, title, author, created_at')
      .order('created_at', { ascending: false }).limit(Math.max(1, Math.min(50, limit)));
    if (error) return { ok: false, why: lagenWhy(error) };
    return { ok: true, list: (data ?? []).map((r) => ({ id: r.id, title: r.title, author: r.author, created: r.created_at, mine: mine.has(r.id) })) };
  });
}

/** Eine Lage mit Code holen */
export function getLage(id) {
  return withClient(async (sb) => {
    const { data, error } = await sb.from('lagen').select('id, title, author, code').eq('id', String(id ?? '')).maybeSingle();
    if (error) return { ok: false, why: lagenWhy(error) };
    return data ? { ok: true, lage: data } : { ok: false, why: 'Diese Lage gibt es nicht (mehr).' };
  });
}

/** Eigene Lage aus dem Netz nehmen */
export function deleteLage(id) {
  return withClient(async (sb) => {
    const { error, count } = await sb.from('lagen').delete({ count: 'exact' }).eq('id', String(id ?? ''));
    if (error) return { ok: false, why: lagenWhy(error) };
    if (!count) return { ok: false, why: 'Nur eigene Lagen lassen sich aus dem Netz nehmen.' };
    writeMine(readMine().filter((x) => x !== id));
    return { ok: true };
  });
}

// ---------- Tageslage ----------

/** Bestenliste eines Tages: [{ name, code, score, faction, held }] */
export function dailyBoard(day, limit = 10) {
  return withClient(async (sb) => {
    const { data, error } = await sb.from('daily_results')
      .select('score, faction, weeks_held, user_id, profiles(username, code)')
      .eq('day', day).order('score', { ascending: false }).order('created_at').limit(limit);
    if (error) return { ok: false, why: why(error) };
    return {
      ok: true,
      list: (data ?? []).map((r) => ({
        name: r.profiles?.username || 'Ohne Namen', code: r.profiles?.code ?? '', points: r.score,
        faction: r.faction, held: r.weeks_held > 0, user: r.user_id,
      })),
    };
  });
}

/** Woche zum Nachrechnen schicken; rounds = Befehle von Seite a je Runde */
export async function submitDaily(day, rounds, points) {
  const u = await ensureUser();
  if (!u.ok) return u;
  return withClient((sb) => invoke(sb, 'submit-daily', { day, rounds, points }));
}

// ---------- Asynchrone Gefechte ----------

/** Neues Gefecht anlegen; liefert { ok, match: { id, code } } */
export async function createMatch(mapId) {
  const u = await ensureUser();
  if (!u.ok) return u;
  return withClient(async (sb) => {
    for (let i = 0; i < 3; i++) {
      const { data, error } = await sb.from('matches').insert({ map_id: mapId }).select('id, code').single();
      if (!error) return { ok: true, match: data };
      if (!/duplicate|unique/i.test(error.message)) return { ok: false, why: why(error) };
    }
    return { ok: false, why: NET };
  });
}

export async function joinMatch(code) {
  const u = await ensureUser();
  if (!u.ok) return u;
  return withClient((sb) => invoke(sb, 'join', { code }));
}

export function withdrawMatch(id) {
  return withClient(async (sb) => {
    const { error } = await sb.from('matches').delete().eq('id', id).eq('status', 'waiting');
    return error ? { ok: false, why: why(error) } : { ok: true };
  });
}

/** Eigene Gefechte, neueste zuerst, mit Seite und Abgabestand der laufenden Runde */
export function listMatches() {
  return withClient(async (sb) => {
    const { data: s } = await sb.auth.getSession();
    const me = s?.session?.user?.id;
    if (!me) return { ok: true, matches: [] };
    const { data, error } = await sb.from('matches')
      .select('id, code, map_id, player_a, player_b, turn, turn_kind, deadline, status, winner, updated_at, created_at')
      .order('updated_at', { ascending: false }).limit(20);
    if (error) return { ok: false, why: why(error) };
    const out = [];
    for (const m of data ?? []) {
      const side = m.player_a === me ? 'a' : 'b';
      let submitted = [];
      if (m.status === 'active') {
        const t = await sb.rpc('lf_turn_status', { p_match: m.id });
        submitted = (t.data ?? []).filter((r) => r.submitted).map((r) => r.side);
      }
      out.push({ ...m, side, submitted });
    }
    return { ok: true, matches: out };
  });
}

/** Ein Gefecht mit eigener Sicht: { match, side, view, submitted } */
export function loadMatch(id) {
  return withClient(async (sb) => {
    const { data: s } = await sb.auth.getSession();
    const me = s?.session?.user?.id;
    if (!me) return { ok: false, why: 'Bitte zuerst anmelden.' };
    const { data: match, error } = await sb.from('matches').select('*').eq('id', id).maybeSingle();
    if (error) return { ok: false, why: why(error) };
    if (!match) return { ok: false, why: 'Dieses Gefecht gibt es nicht oder es gehört dir nicht.' };
    const side = match.player_a === me ? 'a' : 'b';
    const { data: v } = await sb.from('match_views').select('view, turn').eq('match_id', id).eq('user_id', me).maybeSingle();
    const t = await sb.rpc('lf_turn_status', { p_match: id });
    const submitted = (t.data ?? []).filter((r) => r.submitted).map((r) => r.side);
    return { ok: true, match, side, view: v?.view ?? null, submitted };
  });
}

/** Befehle einer Runde abgeben und den Stab rechnen lassen */
export function submitOrders(id, turn, orders) {
  return withClient(async (sb) => {
    const { error } = await sb.from('match_orders').insert({ match_id: id, turn, orders });
    if (error && /row-level security/i.test(error.message)) return { ok: false, why: 'Diese Runde ist beim Stab schon abgeschlossen. Bitte neu laden.' };
    if (error && !/duplicate|unique/i.test(error.message)) return { ok: false, why: why(error) };
    if (error) return { ok: false, why: 'Für diese Runde sind schon Befehle abgegeben.' };
    return invoke(sb, 'resolve', { matchId: id });
  });
}

/** Runde rechnen lassen (z. B. nach verstrichener Frist) */
export function nudgeMatch(id) {
  return withClient((sb) => invoke(sb, 'resolve', { matchId: id }));
}

/** Auf neue Sicht oder Aenderungen eines Gefechts lauschen; liefert eine Abmeldefunktion */
export async function watchMatch(id, onChange) {
  let sb;
  try { sb = await client(); } catch { return () => {}; }
  if (!sb) return () => {};
  const ch = sb.channel('match-' + id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_views', filter: `match_id=eq.${id}` }, () => onChange('view'))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${id}` }, () => onChange('match'))
    .subscribe();
  return () => { sb.removeChannel(ch); };
}
