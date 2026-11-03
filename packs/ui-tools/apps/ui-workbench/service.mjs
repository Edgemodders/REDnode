// The UI Workbench's projects (UT3a): each project is a REDnode package of its own, a folder in
// the projects folder (Documents\REDnode\UI projects, made and watched by the host as a
// development folder), with rednode-app.json, panel.ink.html and mod.mjs. The Workbench's page
// calls these functions through REDnode's mod services; they read and write only inside that
// folder. A project deleted goes to its .trash folder, which REDnode does not scan.
import fs from 'node:fs';
import path from 'node:path';

const MARKUP = 'panel.ink.html';
const SCRIPT = 'mod.mjs';
const MANIFEST = 'rednode-app.json';

// The projects folder the page was given by the host: Documents\REDnode\UI projects, nothing else.
function rootOf(root) {
  const dir = path.resolve(String(root ?? ''));
  if (path.basename(dir) !== 'UI projects' || path.basename(path.dirname(dir)) !== 'REDnode') {
    throw new Error(`Not the UI Workbench's projects folder: ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A project's folder, by its id: one folder name, inside the projects folder.
function projectDir(root, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(id))) throw new Error(`Not a project id: ${id}`);
  return path.join(rootOf(root), id);
}

const slug = (name) =>
  String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function summary(dir) {
  const manifest = readJson(path.join(dir, MANIFEST));
  const stat = (f) => {
    try {
      return fs.statSync(path.join(dir, f)).mtimeMs;
    } catch {
      return 0;
    }
  };
  return {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    dir,
    modified: Math.max(stat(MANIFEST), stat(MARKUP), stat(SCRIPT)),
  };
}

const TEMPLATE_MARKUP = (name) => `<!-- ${name}: a panel of ink markup on the HUD, drawn by the game. The script (${SCRIPT})
     loads it and gives it its data: {level} reads the data's level. Each view.set() in the
     script sends again only what reads the names it changed. Drag the slider in the script's
     window and the panel follows. Run shows it in the game; saving while it runs shows the change. -->
<mount layer="hud" anchor="left" x="80" y="-60">
  <column gap="10">
    <text style="label">{title}</text>
    <row gap="12" align="center">
      <text style="small" tone="dim">Level</text>
      <bar value="{fill}" tone="{tone}" track="dim" width="240" height="8" />
      <text style="value" tone="{tone}">{level}%</text>
    </row>
    <text style="body" tone="{tone}">{mood}</text>
    <text style="small" tone="dim">{changes} changes from the slider. Made in the UI Workbench.</text>
  </column>
</mount>
`;

const TEMPLATE_SCRIPT = (name) => `// ${name}: the script of a UI Workbench project, a REDnode Node mod. It loads the markup
// and gives it its data; view.set() changes the data, and only what reads it is sent again.
// The window below is drawn by REDnode's overlay (F10 shows and hides it); its slider drives
// the panel, which the game draws on its HUD.
import { ink, ui } from 'rednode';

// The functions the markup's on... attributes name (they fire from phase I3, Input).
const handlers = {};

let changes = 0;
// The panel's data for a level from 0 to 100: the names its {slots} read.
function data(level) {
  return {
    level,
    fill: level / 100,
    tone: level >= 90 ? 'danger' : level >= 70 ? 'warning' : 'accent',
    mood: level >= 90 ? 'Overheating!' : level >= 70 ? 'Running hot' : level >= 30 ? 'In the zone' : 'Idling',
    changes,
  };
}

const view = await ink.load('${MARKUP}', handlers, {
  title: ${JSON.stringify(name)},
  ...data(50),
});

// live: the slider sends its value while it is dragged, not only when it is let go.
const level = ui.slider('Level', (value) => {
  changes++;
  view.set(data(value));
}, { min: 0, max: 100, value: 50, unit: '%', live: true });

ui.window({
  title: ${JSON.stringify(`${name}: controls`)},
  anchor: 'right',
  x: -40,
  width: 380,
  height: 230,
  children: [
    ui.text('Drag the slider: the panel on the HUD at the left follows.', { tone: 'dim' }),
    level,
    ui.button('Reset', () => {
      changes = 0;
      level.set({ value: 50 });
      view.set(data(50));
    }, { variant: 'ghost' }),
  ],
});
`;

/** Every project, newest first. */
export function list(root) {
  const dir = rootOf(root);
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      out.push(summary(path.join(dir, entry.name)));
    } catch {
      // not a project (no manifest)
    }
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** A new project from the template: its id comes from its name. */
export function create(root, name) {
  const title = String(name ?? '').trim();
  if (!title) throw new Error('Give the project a name');
  const id = slug(title);
  if (!id) throw new Error('Give a name with letters or digits');
  const dir = projectDir(root, id);
  if (fs.existsSync(dir)) throw new Error(`There is a project "${id}" already`);
  fs.mkdirSync(dir);
  const manifest = {
    id,
    name: title,
    version: '0.1.0',
    author: '',
    description: 'Made in the REDnode UI Workbench: a panel of ink markup on the HUD, driven by a slider.',
    main: SCRIPT,
    open: false,
    requires: { codeware: '>=1.16' },
  };
  fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, MARKUP), TEMPLATE_MARKUP(title));
  fs.writeFileSync(path.join(dir, SCRIPT), TEMPLATE_SCRIPT(title));
  return summary(dir);
}

/** A project's files. */
export function read(root, id) {
  const dir = projectDir(root, id);
  const text = (f) => {
    try {
      return fs.readFileSync(path.join(dir, f), 'utf8');
    } catch {
      return '';
    }
  };
  return { ...summary(dir), markup: text(MARKUP), script: text(SCRIPT) };
}

/** Writes a project's markup and script. */
export function save(root, id, files) {
  const dir = projectDir(root, id);
  if (!fs.existsSync(path.join(dir, MANIFEST))) throw new Error(`No project "${id}"`);
  if (typeof files?.markup === 'string') fs.writeFileSync(path.join(dir, MARKUP), files.markup);
  if (typeof files?.script === 'string') fs.writeFileSync(path.join(dir, SCRIPT), files.script);
  return summary(dir);
}

/** Gives a project a new name (its id and folder stay). */
export function rename(root, id, name) {
  const dir = projectDir(root, id);
  const title = String(name ?? '').trim();
  if (!title) throw new Error('Give the project a name');
  const file = path.join(dir, MANIFEST);
  const manifest = readJson(file);
  manifest.name = title;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return summary(dir);
}

/** Moves a project to the projects folder's .trash, where REDnode does not look. */
export function remove(root, id) {
  const dir = projectDir(root, id);
  if (!fs.existsSync(dir)) throw new Error(`No project "${id}"`);
  const trash = path.join(rootOf(root), '.trash');
  fs.mkdirSync(trash, { recursive: true });
  const to = path.join(trash, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.renameSync(dir, to);
  return { id, movedTo: to };
}
