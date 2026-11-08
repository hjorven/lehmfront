// Kleine Testpartie fuer die Motor-Tests
export const MAP = { id: 'test', width: 24, height: 12 };

export const SCENARIO = {
  id: 'test',
  name: 'Testabschnitt',
  sides: {
    a: {
      faction: 'kaldern',
      groups: [
        { type: 'rifles', pos: { x: 3, y: 2 } },
        { type: 'mg', pos: { x: 3, y: 5 } },
        { type: 'pioneers', pos: { x: 2, y: 8 } },
      ],
    },
    b: {
      faction: 'morrow',
      groups: [
        { type: 'rifles', pos: { x: 20, y: 2 } },
        { type: 'rifles', pos: { x: 20, y: 6 } },
      ],
    },
  },
};

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}
