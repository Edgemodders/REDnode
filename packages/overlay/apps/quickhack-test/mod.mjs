// Quickhack test: a sample of quickhacks.define in the rednode package (#42, for EDGEhack). It gives
// the game's Overheat family a scan check and an on-land function, each switched between rules with
// the buttons, and logs each ask and each landing with the enemy's snapshot.
//
// Check (canUse): Everyone, Nobody, Humans, Slow (answers after 0.3 s), Silent (never answers: the
// game's own result stands after about a second), Throws (the same, and the log says why).
// Land (onLand): Nothing, Damage (30 points from V), Effect (a poison from V), Kill (all its health).

import { quickhacks, ui } from 'rednode';

const OVERHEAT = [
  'Items.OverheatProgram',
  'Items.OverheatLvl1Program',
  'Items.OverheatLvl2Program',
  'Items.OverheatLvl3Program',
  'Items.OverheatLvl4Program',
  'Items.OverheatLvl4PlusPlusProgram',
];

let check = 'Everyone';
let land = 'Nothing';
let undefine = null;

const status = ui.text('Defining Overheat…', { tone: 'dim' });
const rules = ui.text('', { tone: 'normal' });
const log = ui.list({ height: 220 });

const say = (text, tone = 'dim') => status.set({ text, tone });
const note = (line) => {
  log.push(`${new Date().toLocaleTimeString()}  ${line}`);
  console.log(line);
};
const showRules = () => rules.set({ text: `Check: ${check}    Land: ${land}` });
const who = (t) =>
  `level ${Math.round(t.level)}, ${Math.round(t.health)} HP (${Math.round(t.healthPercent)}%)` +
  `${t.isHuman ? ', human' : ''}${t.isMechanical ? ', mechanical' : ''}${t.isDrone ? ', drone' : ''}${t.isBoss ? ', boss' : ''}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checkButton = (name) => ui.button(name, () => ((check = name), showRules(), note(`Check is now ${name}. Scan a new enemy.`)), { variant: 'ghost' });
const landButton = (name) => ui.button(name, () => ((land = name), showRules(), note(`Land is now ${name}.`)), { variant: 'ghost' });

ui.window({
  title: 'Quickhack test',
  anchor: 'left',
  x: 40,
  y: 160,
  width: 520,
  height: 600,
  children: [
    ui.text('Scan check for Overheat (canUse)', { tone: 'dim' }),
    ui.row(checkButton('Everyone'), checkButton('Nobody'), checkButton('Humans')),
    ui.row(checkButton('Slow'), checkButton('Silent'), checkButton('Throws')),
    ui.text('When Overheat lands (onLand)', { tone: 'dim' }),
    ui.row(landButton('Nothing'), landButton('Damage'), landButton('Effect'), landButton('Kill')),
    ui.row(ui.button('Counts', counts, { variant: 'ghost' }), ui.button('Undefine', remove, { variant: 'ghost' }), ui.button('Define', define, { variant: 'ghost' })),
    rules,
    status,
    log,
  ],
});

async function canUse(target, hack) {
  const answer = check === 'Everyone' || (check === 'Humans' && target.isHuman) || (check === 'Slow' && target.isHuman);
  if (check === 'Slow') await sleep(300);
  if (check === 'Silent') await new Promise(() => {});
  if (check === 'Throws') throw new Error('the test rule Throws');
  note(`Asked: ${hack.action} (tier ${hack.tier}) on ${who(target)}: ${answer ? 'usable' : 'not usable'}`);
  return answer;
}

async function onLand(target, hack) {
  note(`Landed: ${hack.action} (tier ${hack.tier}${hack.spread ? ', spread' : ''}, by ${hack.byV ? 'V' : 'someone else'}) on ${who(target)}`);
  if (land === 'Damage') note(`Damage 30: ${(await target.damage(30)) ? 'done' : 'the enemy is gone'}`);
  if (land === 'Effect') note(`Poison: ${(await target.addEffect('BaseStatusEffect.ContagionPoisonLvl2')) ? 'applied' : 'not applied'}`);
  if (land === 'Kill') note(`Kill (${Math.ceil(target.health)} HP): ${(await target.damage(Math.ceil(target.health) + 1)) ? 'done' : 'the enemy is gone'}`);
}

async function define() {
  if (undefine) return say('Overheat is defined already.');
  try {
    undefine = await quickhacks.define(OVERHEAT, { canUse, onLand, disabledText: 'Not on this enemy (test)' });
    const [d] = quickhacks.defined();
    say(`Overheat is defined: ${d.actions.length} hacks, spread and Boss and Chimera versions included.`, 'success');
    note(`Defined: ${d.actions.join(', ')}`);
  } catch (err) {
    say(`Define failed: ${err.message}`, 'danger');
    console.log(`Define failed: ${err.message}`);
  }
}

async function remove() {
  if (!undefine) return say('Overheat is not defined.');
  await undefine();
  undefine = null;
  say('Overheat is the game\'s own again. Scan a new enemy.');
  note('Undefined.');
}

async function counts() {
  try {
    note(`Counts: ${await quickhacks.counts()}`);
  } catch (err) {
    note(`Counts failed: ${err.message}`);
  }
}

showRules();
define();
