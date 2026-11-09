// P20 Online: Nachrechnen, Replay-Link, 1-gegen-1-Runden, Schema und Sicherheit (ohne Netz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { initEtappen } from '../js/etappe-map.js';
import { resolveTurn } from '../js/resolve.js';
import { viewFor } from '../js/view.js';
import { decide } from '../js/ai.js';
import { createArchive, archiveRound } from '../js/archive.js';
import { loadBattle } from '../js/modes/load.js';
import {
  dailyBrief, dailyMap, skirmishScenario, emptyTally, tallyLog, finalReport, limitReached,
} from '../js/modes/skirmish.js';
import {
  replayDaily, replayRounds, recordFrom, checkRecord, cleanOrders, carryOrders, aiOrdersB,
  bytesToB64url, b64urlToBytes, LIMITS,
} from '../js/online/replay.js';
import {
  startMatch, resolveMatch, stateFromView, matchRecord, matchQuery, parseMapId, normalizeCode, turnState,
  MATCH_LIMIT, matchBattle, initSeedFor,
} from '../js/online/match.js';
import { closure, pinnedCommit, repin } from '../tools/sync-functions.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('rein: js/online/replay.js und match.js (auch alles, was die Edge Functions mitnehmen)', () => {
  const FORBIDDEN = [/Math\.random/, /\bDate\b/, /\b(document|window|localStorage|indexedDB)\b/, /Math\.(sin|cos|tan|exp|log|atan2?|pow|hypot)\b/, /localeCompare/];
  for (const f of closure().filter((x) => x.endsWith('.js'))) {
    const src = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of FORBIDDEN) assert.ok(!re.test(src), `${re} in ${f}`);
  }
});

/** Tageslage wie in der Szene "gefecht": Seite a spielt hier die KI (als Ersatz fuer den Spieler) */
function playDailyLikeClient(key, maxRounds = 60) {
  const brief = dailyBrief(key);
  const mapJson = dailyMap(brief);
  const map = loadMap(mapJson);
  const scenario = skirmishScenario(mapJson, { faction: brief.faction, difficulty: brief.difficulty, seed: brief.seed });
  const seed = brief.seed;
  let state = initEtappen(createInitialState(map, scenario, seed), map, scenario);
  const start = state;
  const env = { map };
  const sai = scenario.sides.b.ai;
  let tally = emptyTally(), log = [], memA, memB, carry = { a: [], b: [] }, archive = createArchive('');
  for (let i = 0; i < maxRounds; i++) {
    const da = decide(viewFor(state, log, 'a', env), { map, seed, side: 'a', memory: memA, difficulty: 'veteran' });
    memA = da.memory;
    const fresh = new Set(da.orders.map((o) => o.group));
    const ordersA = [...da.orders, ...carry.a.filter((o) => !fresh.has(o.group))];
    const db = aiOrdersB(state, log, { map, seed, aiCfg: { doctrine: sai.doctrine, difficulty: sai.difficulty }, memory: memB, carried: carry.b });
    memB = db.memory;
    const input = { state, ordersA, ordersB: db.orders, seed, turn: state.turn };
    const r = resolveTurn(state, ordersA, db.orders, seed, state.turn, env);
    tally = tallyLog(tally, r.log, { before: state.turnKind, after: r.state.turnKind });
    archive = archiveRound(archive, input, r);
    state = r.state;
    log = r.log;
    carry = carryOrders(state, log);
    const alive = (s) => state.groups.some((g) => g.side === s && g.status !== 'lost');
    if (limitReached(state, tally, brief.rounds) || !alive('a') || !alive('b')) break;
  }
  return { archive, report: finalReport({ start, end: state, map, tally }) };
}

test('Tageslage: der Server rechnet aus den Befehlen von Seite a dieselben Punkte nach', () => {
  const key = 20261109;
  const { archive, report } = playDailyLikeClient(key);
  const rounds = archive.rounds.map((r) => ({ a: r.ordersA }));
  const r = replayDaily(key, rounds);
  assert.equal(r.ok, true, r.why);
  assert.equal(r.points, report.points);
  assert.equal(r.held, report.held);
  // zweimal gleich (Determinismus)
  assert.deepEqual(replayDaily(key, rounds).report, r.report);
});

test('Tageslage: unfertige, ueberlange und fremde Protokolle zaehlen nicht', () => {
  const key = 20261110;
  const { archive } = playDailyLikeClient(key);
  const rounds = archive.rounds.map((r) => ({ a: r.ordersA }));
  assert.equal(replayDaily(key, rounds.slice(0, 3)).ok, false);
  assert.equal(replayDaily(key, [...rounds, { a: [] }]).ok, false);
  assert.equal(replayDaily(20261399, rounds).ok, false);
  assert.equal(replayDaily(key, 'kaputt').ok, false);
  assert.equal(replayDaily(key, Array.from({ length: LIMITS.rounds + 1 }, () => ({ a: [] }))).ok, false);
});

test('Befehle aus fremder Hand: nur Objekte, begrenzte Zahl und Groesse', () => {
  assert.deepEqual(cleanOrders('x'), []);
  assert.deepEqual(cleanOrders([null, 3, [], { type: 'hold', group: 'a1' }]), [{ type: 'hold', group: 'a1' }]);
  assert.equal(cleanOrders(Array.from({ length: 500 }, () => ({ type: 'hold' }))).length, LIMITS.ordersPerRound);
  assert.deepEqual(cleanOrders([{ type: 'move', path: Array.from({ length: 2000 }, () => ({ x: 1, y: 1 })) }]), []);
});

test('Replay-Link: Protokoll hin und zurueck ergibt denselben Endzustand', async () => {
  const q = 'fraktion=kaldern&karte=velde&ki=veteran&scene=gefecht';
  const b = await loadBattle(new URLSearchParams(q), null);
  const map = loadMap(b.mapJson);
  const seed = 1917;
  const start = initEtappen(createInitialState(map, b.scenario, seed), map, b.scenario);
  const sai = b.scenario.sides.b.ai;
  const played = replayRounds(start, Array.from({ length: 6 }, () => ({ a: [] })), { map, seed, aiCfg: { doctrine: sai.doctrine, difficulty: sai.difficulty } });
  const rec = recordFrom(played.archive, { query: q, seed, title: 'Velder Mühle' });
  const bytes = new TextEncoder().encode(JSON.stringify(rec));
  const back = checkRecord(JSON.parse(new TextDecoder().decode(b64urlToBytes(bytesToB64url(bytes)))));
  assert.ok(back);
  const again = replayRounds(start, back.r, { map, seed: back.s, stopAtEnd: false });
  assert.deepEqual(again.state, played.state);
  assert.deepEqual(again.archive.rounds.map((x) => x.log), played.archive.rounds.map((x) => x.log));
});

test('Replay-Link: base64url fuer alle Laengen und Bytewerte', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n * 31) & 255);
    assert.deepEqual([...b64urlToBytes(bytesToB64url(bytes))], [...bytes]);
  }
});

test('Replay-Link: kaputte, fremde und Kampagnen-Protokolle werden abgewiesen', () => {
  assert.equal(checkRecord(null), null);
  assert.equal(checkRecord({ v: 2, q: '', s: 1, r: [[[], []]] }), null);
  assert.equal(checkRecord({ v: 1, q: 'scene=gefecht&mission=a1m1', s: 1, r: [[[], []]] }), null);
  assert.equal(checkRecord({ v: 1, q: 'scene=gefecht&match=x', s: 1, r: [[[], []]] }), null);
  assert.equal(checkRecord({ v: 1, q: 'scene=gefecht', s: 1, r: [] }), null);
  assert.ok(checkRecord({ v: 1, q: 'scene=gefecht&karte=velde', s: 1, r: [[[{ type: 'hold', group: 'x' }], 'kaputt']] }));
});

test('Zweikampf: Karten-ID und Einladungscode', () => {
  assert.deepEqual(parseMapId('zufall-4711'), { map: 'zufall', mapSeed: 4711 });
  assert.deepEqual(parseMapId('velde'), { map: 'velde' });
  for (const bad of ['zufall', 'zufall-0', 'asse', 'velde;drop', '', null]) assert.equal(parseMapId(bad), null);
  assert.equal(normalizeCode(' k7q x2m '), 'K7QX2M');
  assert.equal(normalizeCode('K7QX2O'), null); // O ist nicht im Alphabet
  assert.equal(normalizeCode('K7QX2'), null);
  // SQL-Pruefung der Karten-ID passt zur Funktion
  const sql = read('supabase/migrations/0001_init.sql');
  assert.match(sql, /map_id ~ '\^\(velde\|kraehenholz\|schacht\|zufall-\[1-9\]\[0-9\]\{0,5\}\)\$'/);
});

test('Zweikampf: Partie laeuft bis zur Rundengrenze, Halten nach verstrichener Frist', () => {
  let { ms, views } = startMatch('kraehenholz', 4242);
  assert.equal(views.a.side, 'a');
  assert.equal(views.b.side, 'b');
  let r, n = 0;
  do {
    r = resolveMatch(JSON.parse(JSON.stringify(ms)), { a: null, b: null });
    ms = r.ms;
    n++;
  } while (!r.finished && n < 80);
  assert.equal(r.finished, true);
  assert.equal(r.ms.tally.positionRounds, MATCH_LIMIT);
  assert.equal(ms.used.length, n);
});

test('Zweikampf: Sicht verraet keine verdeckten Gruppen, Seed und Vorraete der Gegenseite', () => {
  const { ms, views } = startMatch('velde', 99);
  for (const side of ['a', 'b']) {
    const v = views[side];
    const foe = side === 'a' ? 'b' : 'a';
    for (const g of v.groups.filter((x) => x.side === foe)) {
      assert.equal(g.strength, undefined, 'Staerke feindlicher Gruppen');
      assert.equal(g.morale, undefined);
    }
    assert.deepEqual(Object.keys(v.enemy), ['faction']);
    assert.ok(!JSON.stringify(v).includes('"seed"'), 'kein Seed in der Sicht');
    const st = stateFromView(matchBattle('velde').scenario && startMatch('velde', 1).ms.state, v);
    const ids = new Set(v.groups.map((g) => g.id));
    assert.ok(st.groups.every((g) => ids.has(g.id)));
    assert.deepEqual(st.sides[side], v.own);
  }
  assert.ok(ms.seed === 99);
});

test('Zweikampf: Replay-Link einer beendeten Partie zeigt im Gefecht genau dieselbe Partie', async () => {
  let { ms } = startMatch('schacht', 777, initSeedFor('00000000-0000-4000-8000-000000000001'));
  for (let i = 0; i < 5; i++) ms = resolveMatch(ms, { a: [], b: null }).ms;
  const rec = checkRecord(matchRecord(ms, '00000000-0000-4000-8000-000000000001'));
  assert.ok(rec);
  const params = new URLSearchParams(rec.q);
  const b = await loadBattle(params, null);
  const map = loadMap(b.mapJson);
  // wie gefecht.js: Startzustand aus iseed, Wuerfe aus seed
  const init = createInitialState(map, b.scenario, Number(params.get('iseed')));
  init.seed = rec.s;
  const start = initEtappen(init, map, b.scenario);
  const r = replayRounds(start, rec.r, { map, seed: rec.s, stopAtEnd: false });
  assert.deepEqual(r.state, ms.state);
  assert.match(matchQuery('zufall-12', 'id'), /kseed=12/);
});

test('Zweikampf: wer ist am Zug', () => {
  const m = { status: 'active' };
  assert.equal(turnState(m, 'a', []), 'yours');
  assert.equal(turnState(m, 'a', ['a']), 'theirs');
  assert.equal(turnState(m, 'a', ['a', 'b']), 'resolving');
  assert.equal(turnState({ status: 'waiting' }, 'a', []), 'waiting');
});

test('Schema: RLS auf allen Tabellen, verdeckter Zustand ohne Policy, kein geheimer Schluessel im Repo', () => {
  const sql = read('supabase/migrations/0001_init.sql');
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  for (const t of tables) assert.match(sql, new RegExp(`alter table public\\.${t}\\s+enable row level security`), t);
  assert.ok(!/create policy [^;]* on public\.match_states/.test(sql), 'match_states ohne Policy');
  assert.ok(!/create policy [^;]* on public\.daily_orders/.test(sql), 'daily_orders ohne Policy');
  assert.ok(!/policy "teilnehmer sehen match"[^;]*status = 'waiting'/.test(sql), 'wartende Partien nicht fuer alle');
  // Seed nicht in der Sicht, fremde Befehle erst nach dem Ende
  assert.match(sql, /m\.status = 'finished'/);
  const cfg = read('js/config/online.js');
  assert.ok(!/sb_secret_|service_role/.test(cfg.replace(/\/\/.*$/gm, '')), 'nur anon/publishable Key');
  // nirgends ein Service-Role-JWT
  const walk = (dir) => readdirSync(new URL('../' + dir, import.meta.url), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(dir + d.name + '/') : [dir + d.name]));
  for (const f of [...walk('js/'), ...walk('supabase/migrations/'), 'supabase/config.toml']) {
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/.test(read(f)), 'JWT in ' + f);
  }
});

test('Zweikampf: die Sicht beim Start verraet nichts ueber den geheimen Seed', () => {
  const i = initSeedFor('00000000-0000-4000-8000-0000000000aa');
  const one = startMatch('velde', 12345, i).views;
  const two = startMatch('velde', 987654321, i).views;
  assert.deepEqual(one, two);
});

test('Edge Functions: logic.ts auf genau einen Commit gepinnt, exportiert nur Vorhandenes', async () => {
  const src = read('supabase/functions/_lib/logic.ts');
  const sha = pinnedCommit(src);
  assert.match(sha, /^[0-9a-f]{40}$/);
  const match = await import('../js/online/match.js');
  const replay = await import('../js/online/replay.js');
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*'[^']*\/js\/online\/(\w+)\.js'/g)) {
    const mod = m[2] === 'match' ? match : replay;
    for (const name of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      assert.equal(typeof mod[name], 'function', `${name} fehlt in ${m[2]}.js`);
    }
  }
  const other = 'a'.repeat(40);
  assert.equal(pinnedCommit(repin(src, other)), other);
  assert.throws(() => repin(src, 'main'));
  for (const fn of ['join', 'resolve', 'submit-daily']) {
    const idx = read(`supabase/functions/${fn}/index.ts`);
    assert.ok(!idx.includes('_shared'), `${fn} importiert noch die alte Kopie`);
  }
});

test('Lageaustausch: RLS an, lesen für alle, anlegen und löschen nur eigene, ändern niemand, Grenze je Spieler', () => {
  const sql = read('supabase/migrations/0002_lagen.sql');
  assert.match(sql, /alter table public\.lagen enable row level security/);
  assert.match(sql, /policy "lagen lesbar" on public\.lagen for select using \(true\)/);
  assert.match(sql, /for insert to authenticated with check \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /for delete to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.ok(!/for update/.test(sql), 'keine Update-Policy');
  assert.match(sql, /revoke update on public\.lagen from anon, authenticated/);
  assert.match(sql, /code like 'L1\.%'/);
  assert.match(sql, />= 20/);
  assert.match(sql, /set search_path = ''/);
});

test('Lageaustausch gehärtet: nur title, author, code beim Anlegen, Code nur base64url', () => {
  const sql = read('supabase/migrations/0003_lagen_haerten.sql');
  assert.match(sql, /grant insert \(title, author, code\) on public\.lagen to authenticated/);
  assert.match(sql, /grant select on public\.lagen to anon, authenticated/);
  assert.match(sql, /\^L1\\\.\[A-Za-z0-9_-\]\+\$/);
});
