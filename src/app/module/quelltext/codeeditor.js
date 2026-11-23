// module/quelltext/codeeditor – Rohtext-Editor auf CodeMirror 6 (Drittkomponente, MIT, Block src/js/fremd/codemirror.js):
// Zeilennummern, Verlauf, Suchen und Ersetzen; die Einfärbung kommt aus den Token des Parsers, nicht aus einer eigenen Grammatik.

const PHRASES_DE = {
  Find: 'Suchen', Replace: 'Ersetzen', next: 'weiter', previous: 'zurück', all: 'alle', 'match case': 'Groß-/Kleinschreibung',
  'by word': 'Ganzes Wort', regexp: 'Regulärer Ausdruck', replace: 'Ersetzen', 'replace all': 'Alle ersetzen', close: 'Schließen',
};

// hooks.tokens(lineNumber, text) → [{ from, to, kind }] (Spalten in der Zeile, kind wird zur Klasse ts-<kind>),
// hooks.changed(text, [[ersteZeile, letzteZeile, neueZeilen], …]) nach jeder Änderung (Zeilen ab 0, vor der Änderung),
// hooks.cursor() nach jeder Änderung von Text oder Auswahl.
function createSourceEditor(parent, text, hooks, lang) {
  const {
    EditorView, ViewPlugin, Decoration, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
    EditorState, EditorSelection, StateEffect, history, historyKeymap, defaultKeymap, undo, redo,
    search, searchKeymap, highlightSelectionMatches, openSearchPanel,
  } = window.CodeMirror6;
  const repaint = StateEffect.define();

  // Only the visible lines are coloured; a large file stays fast.
  const marks = view => {
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        for (const token of hooks.tokens(line.number, line.text)) {
          if (line.from + token.from < pos || line.from + token.from > to) continue;
          ranges.push(Decoration.mark({ class: 'ts-' + token.kind }).range(line.from + token.from, line.from + token.to));
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  };
  const colouring = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = marks(view); }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.transactions.some(tr => tr.effects.some(e => e.is(repaint)))) {
        this.decorations = marks(update.view);
      }
    }
  }, { decorations: plugin => plugin.decorations });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorState.phrases.of(lang === 'en' ? {} : PHRASES_DE),
        lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(),
        keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap]),
        search({ top: true }), highlightSelectionMatches(), drawSelection(),
        EditorView.contentAttributes.of({
          'aria-label': lang === 'en' ? 'Touchstone source' : 'Touchstone-Quelltext',
          spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off',
        }),
        colouring,
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            const changes = [];
            update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => changes.push([
              update.startState.doc.lineAt(fromA).number - 1, update.startState.doc.lineAt(toA).number - 1, inserted.lines - 1]));
            hooks.changed(update.state.doc.toString(), changes);
          }
          if (update.docChanged || update.selectionSet) hooks.cursor();
        }),
      ],
    }),
  });

  const cursor = () => {
    const head = view.state.selection.main.head, line = view.state.doc.lineAt(head);
    return { line: line.number, col: head - line.from, text: line.text };
  };
  const jump = (lineNumber, column = 0, length = 0) => {
    const line = view.state.doc.line(Math.max(1, Math.min(lineNumber, view.state.doc.lines)));
    const from = Math.min(line.to, line.from + Math.max(0, column));
    view.dispatch({ selection: EditorSelection.range(from, Math.min(line.to, from + length)), effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    view.focus();
  };
  // Replace line by line, so the history keeps one step and unchanged lines keep their marks.
  const applyLines = next => {
    const changes = [];
    next.split('\n').forEach((content, i) => {
      const line = view.state.doc.line(i + 1);
      if (content !== line.text) changes.push({ from: line.from, to: line.to, insert: content });
    });
    view.dispatch({ changes });
  };
  // Replace only the differing middle part of the document.
  const replaceText = next => {
    const current = view.state.doc.toString();
    let start = 0, endA = current.length, endB = next.length;
    while (start < endA && start < endB && current[start] === next[start]) start++;
    while (endA > start && endB > start && current[endA - 1] === next[endB - 1]) { endA--; endB--; }
    view.dispatch({ changes: { from: start, to: endA, insert: next.slice(start, endB) } });
  };
  const replaceToken = (lineNumber, column, length, value) => {
    const from = view.state.doc.line(lineNumber).from + column;
    view.dispatch({ changes: { from, to: from + length, insert: value } });
  };
  return {
    cursor, jump, applyLines, replaceText, replaceToken,
    search: () => openSearchPanel(view), undo: () => undo(view), redo: () => redo(view),
    refresh: () => view.dispatch({ effects: repaint.of(null) }), destroy: () => view.destroy(),
  };
}

export { createSourceEditor };
