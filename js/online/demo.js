// Beispieldaten fuer Screenshots des Fernsprechamts ohne Netz (?scene=fernamt&demo=an|aus). Gleiche Schnittstelle
// wie js/net.js, nur lesend; Schreibaktionen melden freundlich, dass dies eine Vorfuehrung ist.
const H = 3600 * 1000;
const NOW = Date.parse('2026-11-09T09:00:00Z');

export function demoNet(connected) {
  const no = async () => ({ ok: false, why: 'Vorführung: hier geht nichts an den Stab.' });
  const iso = (ms) => new Date(ms).toISOString();
  const matches = [
    { id: '00000000-0000-4000-8000-000000000001', code: 'K7QX2M', map_id: 'velde', side: 'a', turn: 6, turn_kind: 'position', status: 'active', deadline: iso(Date.now() + 31 * H), submitted: ['b'], updated_at: iso(NOW) },
    { id: '00000000-0000-4000-8000-000000000002', code: 'R4TW9P', map_id: 'kraehenholz', side: 'b', turn: 11, turn_kind: 'battle', status: 'active', deadline: iso(Date.now() + 3 * H), submitted: ['b'], updated_at: iso(NOW - 2 * H) },
    { id: '00000000-0000-4000-8000-000000000003', code: 'HN8V3C', map_id: 'zufall-4711', side: 'a', turn: 1, turn_kind: 'position', status: 'waiting', deadline: null, submitted: [], updated_at: iso(NOW - 5 * H) },
    { id: '00000000-0000-4000-8000-000000000004', code: 'BX2D7Q', map_id: 'schacht', side: 'b', turn: 31, turn_kind: 'position', status: 'finished', winner: 'b', deadline: null, submitted: [], updated_at: iso(NOW - 50 * H), record: { v: 1, q: 'fraktion=kaldern&karte=schacht&mode=hotseat&runden=14&scene=gefecht&seed=99', s: 99, t: 'Zweikampf', r: [[[], []]] } },
  ];
  return {
    onlineEnabled: () => connected,
    currentUser: async () => ({ ok: true, user: connected ? { id: 'demo', anonymous: true, email: null } : null }),
    myProfile: async () => ({ ok: true, profile: { id: 'demo', username: 'Feldwebel Brandt', code: 'KQ7M4TXA' } }),
    signInAnon: no, signInEmail: no, linkEmail: no, signOut: no, setUsername: no,
    listMatches: async () => ({ ok: true, matches }),
    createMatch: no, joinMatch: no, withdrawMatch: no, loadMatch: no,
    cloudList: async () => ({ ok: true, saves: [{ slot: 1, label: 'Tag 3, 18 Uhr, Regen', version: 2, updated_at: iso(NOW - 26 * H) }, { slot: 3, label: 'Tag 1, 6 Uhr', version: 2, updated_at: iso(NOW - 70 * H) }] }),
    cloudPut: no, cloudGet: no,
    dailyBoard: async () => ({
      ok: true,
      list: [
        { name: 'Ostervenn', code: 'M2KD8QRT', points: 214, faction: 'kaldern', held: true, user: 'x1' },
        { name: 'Feldwebel Brandt', code: 'KQ7M4TXA', points: 187, faction: 'kaldern', held: true, user: 'demo' },
        { name: 'Raudas', code: 'ZP4W7NHC', points: 151, faction: 'kaldern', held: true, user: 'x2' },
        { name: 'Ohne Namen', code: 'T8RX3MVB', points: 64, faction: 'kaldern', held: false, user: 'x3' },
      ],
    }),
    demoLocal: () => [
      { slot: 'auto', turn: 9, meta: { title: 'Tag 3, 18 Uhr, Regen' } },
      { slot: 'tasche-2', turn: 4, meta: { title: 'Tag 2, 6 Uhr, Nebel' } },
    ],
  };
}
