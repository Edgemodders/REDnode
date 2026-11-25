// Fight test: REDnode's fight events (#61). game.on('combat') hears V enter and leave combat;
// game.on('npcDowned') hears every person defeated or killed, sent by the game as it happens.
// A person defeated and then finished off sends two events with the same entity, so the
// count below counts people by entity.

import { game, ui } from 'rednode';

const time = () => new Date().toLocaleTimeString();
const state = ui.text('Combat: not heard yet', { tone: 'dim' });
const tally = ui.text('V has downed nobody yet.', { tone: 'dim' });
const log = ui.list({ keep: 300 });
const byV = new Map(); // affiliation -> set of entities V downed

function showTally() {
  const parts = [...byV].map(([aff, set]) => `${aff.replace(/^Factions\./, '')} ${set.size}`);
  tally.set({ text: parts.length ? `Downed by V: ${parts.join(', ')}` : 'V has downed nobody yet.' });
}

game.on('combat', (e) => {
  state.set({ text: `Combat: ${e.inCombat ? 'in combat' : 'out of combat'} (${time()})` });
  log.push(`${time()}  ${e.inCombat ? 'V entered combat' : 'V left combat'}`);
});

game.on('npcDowned', (e) => {
  log.push(`${time()}  ${e.killed ? 'Killed' : 'Defeated'}: ${e.record ?? '(no record)'}, ${e.affiliation ?? 'no affiliation'}, by ${e.by}`);
  console.log(`npcDowned ${JSON.stringify({ entity: e.entity, record: e.record, affiliation: e.affiliation, killed: e.killed, byPlayer: e.byPlayer, by: e.by })}`);
  if (!e.byPlayer) return;
  const aff = e.affiliation ?? 'no affiliation';
  if (!byV.has(aff)) byV.set(aff, new Set());
  byV.get(aff).add(e.entity);
  showTally();
});

ui.window({
  title: 'Fight test',
  width: 520,
  height: 380,
  children: [
    state,
    tally,
    log,
    ui.row(ui.button('Clear', () => { log.clear(); byV.clear(); showTally(); }, { variant: 'ghost' })),
  ],
});
