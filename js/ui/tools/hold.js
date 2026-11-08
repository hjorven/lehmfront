// Werkzeug Halten (Taste H): ausdruecklicher Befehl, ohne Ziel. Gruppen ohne Befehl halten ohnehin (Plan 7.3).
import { registerTool } from '../tools.js';

registerTool({
  id: 'hold',
  key: 'h',
  label: 'Halten',
  order: 50,
  icon: '<path d="M9 5 V19"/><path d="M15 5 V19"/>',
  canUse(group) {
    return group.status === 'lost' ? 'Gruppe ist aufgerieben' : true;
  },
  begin(ctx) {
    ctx.setOrder({ group: ctx.group.id, type: 'hold' });
    ctx.cancel();
  },
});
