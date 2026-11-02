// What the UI Workbench's editor needs from CodeMirror 6 and acorn, bundled by build-editor.mjs
// into packs/ui-tools/apps/ui-workbench/vendor/editor.js (one ES module, no other files).
export { EditorView, basicSetup } from 'codemirror';
export { EditorState, Compartment } from '@codemirror/state';
export { keymap } from '@codemirror/view';
export { indentWithTab } from '@codemirror/commands';
export { html } from '@codemirror/lang-html';
export { javascript } from '@codemirror/lang-javascript';
export { linter, lintGutter, setDiagnostics } from '@codemirror/lint';
export { autocompletion } from '@codemirror/autocomplete';
export { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
export { tags } from '@lezer/highlight';
export { parse as parseScript } from 'acorn';
