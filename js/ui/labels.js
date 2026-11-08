// Bezeichnungen fuer die Oberflaeche: Gruppennamen, Zustandswoerter, Wetter, Uhrzeit. Rein, ohne DOM.
import { unitType } from '../config/units.js';
import { ORDER_TYPES } from '../config/orders.js';
import { compareId } from '../state.js';

/** Kurzzeichen im Kartensymbol: Schuetzen tragen ihre Nummer, alle anderen ein Kuerzel */
export const MARKS = { mg: 'MG', pioneers: 'Pi', medics: 'San', runners: 'Me', observers: 'Beo', mortar: 'Mö' };

/** Laufende Nummer einer Gruppe auf ihrer Seite (1-basiert, nach ID, aufgeriebene zaehlen mit) */
export function groupNumber(state, group) {
  const ids = state.groups.filter((g) => g.side === group.side).map((g) => g.id).sort(compareId);
  return ids.indexOf(group.id) + 1;
}

export function groupName(state, group) {
  return `${groupNumber(state, group)}. Gruppe`;
}

export function groupMark(state, group) {
  return MARKS[group.type] ?? String(groupNumber(state, group));
}

export function typeName(group) {
  return unitType(group.type).name;
}

export function leaderShort(group) {
  const n = group.leader?.name ?? '';
  const i = n.indexOf(' ');
  return 'Gf. ' + (i < 0 ? n : n.slice(i + 1));
}

export function fatigueWord(f) {
  return f >= 70 ? 'hoch' : f >= 35 ? 'mittel' : 'gering';
}

export const WEATHER = { clear: 'klar', rain: 'Regen', fog: 'Nebel', snow: 'Schnee', storm: 'Sturm', overcast: 'bedeckt' };

export function weatherName(w) {
  return WEATHER[w?.kind] ?? 'klar';
}

export function clockText(clock) {
  return String(clock.hour).padStart(2, '0') + ':' + String(clock.minute).padStart(2, '0');
}

export function roundTitle(state) {
  return state.turnKind === 'battle' ? `Gefechtsrunde ${state.battle?.round ?? state.turn}` : `Stellungsrunde ${state.turn}`;
}

export function orderLabel(type) {
  return ORDER_TYPES[type]?.label ?? type;
}

/** Plural mit Zahl: plural(2, 'Gruppe', 'Gruppen') -> "2 Gruppen" */
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}
