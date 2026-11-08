// Namenslisten aus data/names.json. Einziger Ort, der die JSON-Datei laedt (Import-Attribute,
// Chrome 123+, Safari 17.2+, Firefox 138+, Node 22). Falls noetig hier gegen fetch tauschen.
import names from '../../data/names.json' with { type: 'json' };

export const NAMES = names;
