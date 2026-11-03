// Views mod: one window, two views. The title bar has buttons of the mod's own, and
// win.set swaps the window's title, buttons and content in place: the window keeps its
// place and size, so nothing closes and opens again.

import { ui } from 'rednode';

let presses = 0;
let pinned = false;

// The main view. Its nodes keep their state while the settings view shows.
const counter = ui.text('No presses yet.');
const main = [
  ui.text('The main view. The gear in the title bar opens the settings view.', { tone: 'dim' }),
  counter,
  ui.button('Press', () => counter.set({ text: `${++presses} press${presses === 1 ? '' : 'es'}.` })),
];

// The settings view, with a way back in the view and in the title bar.
const greeting = ui.input({ value: 'Hello, Night City', placeholder: 'A greeting' });
const settings = [
  ui.text('The settings view. The arrow in the title bar, or Done, goes back.', { tone: 'dim' }),
  greeting,
  ui.button('Done', () => showMain()),
];

const win = ui.window({
  title: 'Views',
  width: 380,
  height: 260,
  titleButtons: mainButtons(),
  children: main,
});

// The first button sits next to close. Pin is a switch, lit while on; Help has no icon,
// so its label shows.
function mainButtons() {
  return [
    { id: 'settings', label: 'Settings', icon: 'settings', onClick: () => showSettings() },
    { id: 'pin', label: pinned ? 'Unpin' : 'Pin', icon: 'pin', on: pinned, onClick: () => togglePin() },
    { id: 'help', label: 'Help', onClick: () => console.log('Help: the gear swaps the view, Pin lights up, the arrow comes back.') },
  ];
}

function showSettings() {
  win.set({
    title: 'Views: settings',
    titleButtons: [{ id: 'back', label: 'Back', icon: 'back', onClick: () => showMain() }],
    children: settings,
  });
  console.log('Settings view');
}

function showMain() {
  win.set({ title: `Views: ${greeting.props.value || 'main'}`, titleButtons: mainButtons(), children: main });
  console.log('Main view');
}

function togglePin() {
  pinned = !pinned;
  win.set({ titleButtons: mainButtons() }); // only the buttons change
  console.log(pinned ? 'Pinned' : 'Unpinned');
}
