// Ask mod: a sample of agent.ask in the rednode package. A question typed here goes
// to the AI assistant (REDagent), and its answer streams into the window.
// Needs "permissions": ["agent"] in rednode-app.json and the player's OK.

import { agent, game, ui } from 'rednode';

let question = '';
let asking = null; // AbortController of the question in progress
let model = 'sonnet'; // REDnode 0.72.0: a model family, which REDagent maps to its newest model
let noTools = false; // REDnode 0.72.0: answer from the question and context alone

const answer = ui.text('Ask about the game or your mods. Each answer costs a little.', { tone: 'dim' });
const cost = ui.text('', { tone: 'dim' });
const askButton = ui.button('Ask', ask);
const stopButton = ui.button('Stop', () => asking?.abort(), { variant: 'ghost', disabled: true });

ui.window({
  title: 'Ask mod',
  anchor: 'left',
  x: 40,
  y: 120,
  width: 420,
  height: 520,
  children: [
    ui.input({
      placeholder: 'Your question (Enter to ask)',
      onChange: (v) => (question = v),
      onSubmit: (v) => {
        question = v;
        ask();
      },
    }),
    ui.select('Model', [{ value: 'sonnet', label: 'Sonnet (default)' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }], {
      value: model,
      onChange: (v) => (model = v),
    }),
    ui.toggle('No tools: answer from the question alone', (on) => (noTools = on), { tip: 'Quicker and cheaper; REDagent reads nothing from the game' }),
    ui.row(askButton, stopButton),
    answer,
    cost,
  ],
});

async function ask() {
  if (asking || !question.trim()) return;
  asking = new AbortController();
  askButton.set({ disabled: true });
  stopButton.set({ disabled: false });
  answer.set({ text: '', tone: 'normal' });
  cost.set({ text: 'Asking...' });
  let text = '';
  try {
    // Context the assistant would not otherwise know: where the player is.
    const where = await game.player.position().catch(() => null);
    const result = await agent.ask(question, {
      context: { mod: 'Ask mod', playerPosition: where },
      model,
      tools: !noTools,
      onText: (t) => {
        text += t;
        answer.set({ text });
      },
      signal: asking.signal,
    });
    answer.set({ text: result.text });
    cost.set({ text: `This answer cost $${result.cost.toFixed(4)} (${model}${noTools ? ', no tools' : ''})` });
    console.log(`Answered for $${result.cost.toFixed(4)} (${model}${noTools ? ', no tools' : ''}): ${question.slice(0, 80)}`);
  } catch (err) {
    answer.set({ text: err.message, tone: 'dim' });
    cost.set({ text: '' });
    console.log(`No answer: ${err.message}`);
  } finally {
    asking = null;
    askButton.set({ disabled: false });
    stopButton.set({ disabled: true });
  }
}

console.log('Ask mod ready');
