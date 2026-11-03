// To source (UT3b, docs/ink.md "UT3 Workbench: plan"): a tree of the game's own widgets, read
// with ink.read(..., { props: true }), written as REDnode's ink markup, for a new project that
// shows a copy of it. No imports: the page uses it, and a check runs it in plain Node.
//
// What the markup cannot say is approximated and listed in the file's first comment: anchors
// that fill one way only, a panel's child margin (added to each child's margin), fonts other
// than the game's default, colours brighter than white (HDR). The copy is still: the game's
// own controller is what fills and animates the original.

const TAGS = {
  inkCanvasWidget: 'canvas',
  inkVerticalPanelWidget: 'column',
  inkHorizontalPanelWidget: 'row',
  inkTextWidget: 'text',
  inkRectangleWidget: 'rect',
  inkCircleWidget: 'circle',
  inkImageWidget: 'image',
};
// What may go inside each tag.
const HOLDS = { canvas: true, column: true, row: true, widget: true };
const PANELS = { canvas: true, column: true, row: true };
const ANCHORS = {
  TopLeft: 'top-left',
  TopCenter: 'top',
  TopRight: 'top-right',
  CenterLeft: 'left',
  Centered: 'center',
  CenterRight: 'right',
  BottomLeft: 'bottom-left',
  BottomCenter: 'bottom',
  BottomRight: 'bottom-right',
  Fill: 'fill',
};
const H_ALIGN = { Left: 'left', Center: 'center', Right: 'right' };
const V_ALIGN = { Top: 'top', Center: 'center', Bottom: 'bottom' };
const CASES = { UpperCase: 'upper', LowerCase: 'lower' };
const TEXT_ALIGN = { Center: 'center', Right: 'right' };

export const MAX_WIDGETS = 600;

const round = (n) => Math.round(Number(n) * 100) / 100;
const escapeText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '{{').replace(/\}/g, '}}');
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;');
const tagOf = (cls) => TAGS[cls] ?? TAGS[`${cls}Widget`] ?? 'widget';
// <widget class="..."> by the script's name (inkFlex); the driver tries the native one next.
const scriptClass = (cls) => cls.replace(/Widget$/, '');

function hex(color) {
  if (!color) return null;
  const byte = (n) => Math.max(0, Math.min(255, Math.round((Number(n) || 0) * 255)));
  const [r, g, b, a] = [color.Red, color.Green, color.Blue, color.Alpha ?? 1].map(byte);
  const two = (n) => n.toString(16).padStart(2, '0');
  return `#${two(r)}${two(g)}${two(b)}${a === 255 ? '' : two(a)}`;
}
const brighter = (color) => color && [color.Red, color.Green, color.Blue].some((n) => Number(n) > 1.001);

function sidesText(m) {
  const s = [m.left, m.top, m.right, m.bottom].map((n) => round(n || 0));
  if (s.every((n) => n === 0)) return null;
  return s.every((n) => n === s[0]) ? String(s[0]) : s.join(' ');
}
const addSides = (a, b) => ({
  left: (a?.left || 0) + (b?.left || 0),
  top: (a?.top || 0) + (b?.top || 0),
  right: (a?.right || 0) + (b?.right || 0),
  bottom: (a?.bottom || 0) + (b?.bottom || 0),
});

// A resource hash as the plugin reads it (a decimal string) in hex, or null for none.
function hashText(value) {
  if (value === undefined || value === null || value === '' || value === '0') return null;
  try {
    const n = BigInt(value);
    return n === 0n ? null : `0x${n.toString(16).padStart(16, '0')}`;
  } catch {
    return String(value);
  }
}

/**
 * The markup for a tree read with props, and the project's script.
 * root: ink.read's root node. place: { box, layerSize } of the original on screen, to put the
 * copy beside it. Answers { markup, script, widgets, hidden, notes }.
 */
export function toSource(root, { box = null, layerSize = null, path = '', name = '', cut = false, date = new Date() } = {}) {
  const notes = new Set();
  let widgets = 0;
  let hidden = 0;
  let stopped = cut;

  const write = (node, parentTag, extraMargin, depth) => {
    const p = node.props ?? {};
    const layout = p.layout ?? {};
    const isRoot = depth === 0;
    if (!isRoot && (node.visible === false || Number(node.opacity) === 0)) {
      hidden += 1;
      return '';
    }
    if (widgets >= MAX_WIDGETS) {
      stopped = true;
      return '';
    }
    widgets += 1;
    const tag = tagOf(node.class);
    const attrs = [];
    const attr = (k, v) => {
      if (v !== null && v !== undefined && v !== '') attrs.push(`${k}="${escapeAttr(v)}"`);
    };
    if (tag === 'widget') attr('class', scriptClass(node.class));
    if (node.name && node.name !== 'None') attr('id', node.name);

    const inPanel = parentTag === 'column' || parentTag === 'row';
    if (inPanel) {
      const align = parentTag === 'column' ? H_ALIGN[layout.HAlign] : V_ALIGN[layout.VAlign];
      attr('align', align);
      if (layout.sizeRule === 'Stretch') attr('grow', round(layout.sizeCoefficient ?? 1));
    } else if (!isRoot) {
      const anchor = layout.anchor;
      if (anchor && anchor !== 'TopLeft') {
        if (ANCHORS[anchor]) attr('anchor', ANCHORS[anchor]);
        else {
          attr('anchor', 'fill');
          notes.add(`anchor ${anchor} written as fill`);
        }
      }
      const t = p.renderTransform?.translation;
      if (t && round(t.X)) attr('x', round(t.X));
      if (t && round(t.Y)) attr('y', round(t.Y));
    }
    attr('margin', sidesText(addSides(layout.margin, extraMargin)));
    if (PANELS[tag]) attr('pad', sidesText(layout.padding ?? {}));
    else if (tag === 'widget' && sidesText(layout.padding ?? {})) notes.add('padding on <widget> left out');

    // A size of its own, or the drawn size when it has none and does not fit its content.
    const fits = p.fitToContent === true;
    const size = p.size ?? {};
    const drawn = node.drawn ?? [0, 0];
    const fitsByItself = tag === 'column' || tag === 'row' || tag === 'text';
    if (!fits && size.X > 0 && size.Y > 0) {
      attr('width', round(size.X));
      attr('height', round(size.Y));
    } else if (!fits && !fitsByItself && drawn[0] > 0 && drawn[1] > 0) {
      attr('width', round(drawn[0]));
      attr('height', round(drawn[1]));
    }

    const color = hex(p.tintColor);
    if (color && color !== '#ffffff') attr('color', color);
    if (brighter(p.tintColor)) notes.add('colours brighter than white (HDR) written at white');
    if (p.opacity !== undefined && round(p.opacity) !== 1) attr('opacity', round(p.opacity));
    if (isRoot && node.visible === false) attr('visible', 'false');

    let inner = '';
    if (tag === 'text') {
      if (p.fontSize) attr('size', p.fontSize);
      if (p.fontStyle && p.fontStyle !== 'None') attr('weight', p.fontStyle);
      attr('case', CASES[p.letterCase]);
      attr('textAlign', TEXT_ALIGN[p.textHorizontalAlignment]);
      inner = escapeText(node.text ?? '');
    }
    if (tag === 'image') {
      attr('atlas', hashText(p.textureAtlas));
      if (p.texturePart && p.texturePart !== 'None') attr('part', p.texturePart);
    }

    const pad = '  '.repeat(depth + 1);
    const open = `${pad}<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    if (tag === 'text') return `${open}>${inner}</text>\n`;
    const kids = HOLDS[tag] ? node.children ?? [] : [];
    if (HOLDS[tag] && (node.children?.length ?? 0) < (node.count ?? 0)) stopped = true;
    // A panel's child margin spaces every child: added to each child's own.
    const childMargin = (tag === 'column' || tag === 'row') && p.childMargin ? p.childMargin : null;
    const body = kids.map((c) => write(c, tag, childMargin, depth + 1)).join('');
    return body ? `${open}>\n${body}${pad}</${tag}>\n` : `${open} />\n`;
  };

  const tree = write(root, '', null, 0);

  // Beside the original: to its right, else to its left, else below it.
  let x = 80;
  let y = 80;
  if (box) {
    const [bx, by, bw, bh] = box;
    const width = layerSize?.[0] ?? 3840;
    const height = layerSize?.[1] ?? 2160;
    if (bx + bw + 40 + bw <= width) [x, y] = [bx + bw + 40, by];
    else if (bx - bw - 40 >= 0) [x, y] = [bx - bw - 40, by];
    else [x, y] = [bx, Math.min(by + bh + 40, Math.max(0, height - bh))];
  }
  if (stopped) notes.add(`stopped at ${MAX_WIDGETS} widgets or where the read stopped`);

  const day = date.toISOString().slice(0, 10);
  const what = (path || name || root.class).replace(/--/g, '- -');
  const header = [
    `<!-- A copy of the game's ${what}, made with To source in the UI Workbench on ${day}:`,
    `     ${widgets} widget${widgets === 1 ? '' : 's'}${hidden ? `, ${hidden} hidden one${hidden === 1 ? '' : 's'} left out` : ''}.`,
    '     It is still: the game\'s own controller is what fills and moves the original.',
    ...(notes.size ? [`     Approximated: ${[...notes].join('; ')}.`] : []),
    '     The mount puts it beside the original; change x and y to move it. -->',
  ].join('\n');
  const markup = `${header}\n<mount layer="hud" anchor="top-left" x="${round(x)}" y="${round(y)}">\n${tree}</mount>\n`;

  const title = name || root.name || root.class;
  const script = `// ${title.replace(/\n/g, ' ')}: a copy of the game's ${what.replace(/\n/g, ' ')}, made with To source in the
// UI Workbench. It loads the markup with no data; give it data names ({name} in the markup)
// and pass them here to fill it from your own code.
import { ink } from 'rednode';

// The functions the markup's on... attributes name (they fire from phase I3, Input).
const handlers = {};

const view = await ink.load('panel.ink.html', handlers, {});
`;
  return { markup, script, widgets, hidden, notes: [...notes] };
}
