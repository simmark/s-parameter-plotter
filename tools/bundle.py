"""Bundles the ES modules in src/app/ into one script for index.html (used by tools/build.py).

Rules for module files (checked here and by tests/module.mjs):
  - imports only at the top:      import { a, b as c } from './pfad.js';
  - exports only as one list:     export { a, b };   (usually at the end of the file)
  - no default exports, no `export function …`, no re-exports, no import of the whole module.
Each module runs in its own function scope, so everything that is not exported stays private.
Load order: a module runs after the modules it imports from. In a cycle, an imported FUNCTION from a module that runs
later is reached through a small forwarding function; an imported VALUE (const object, number, …) must come from a
module that runs earlier, otherwise the build stops with a message. src/app/oberflaeche/start.js always runs last.
"""
import pathlib, re

IMPORT = re.compile(r"^import \{([^}]*)\} from '([^']+)';[ \t]*\n", re.M)
EXPORT = re.compile(r"^export \{([^}]*)\};[ \t]*\n?", re.M)
FORBIDDEN = re.compile(r"^(export (?!\{)|import (?!\{))", re.M)
LAST = 'oberflaeche/start.js'


class BundleError(SystemExit):
    pass


def _names(text):
    return [n.strip() for n in text.replace('\n', ' ').split(',') if n.strip()]


def _var(path):
    return '__modul_' + re.sub(r'\W', '_', path[:-3])


def read_modules(app):
    mods = {}
    for p in sorted(app.rglob('*.js')):
        rel = p.relative_to(app).as_posix()
        text = p.read_bytes().decode('utf-8')
        imports = []
        for m in IMPORT.finditer(text):
            target = (pathlib.PurePosixPath(rel).parent / m.group(2)).as_posix()
            parts = []
            for part in target.split('/'):
                if part == '..': parts.pop()
                elif part not in ('.', ''): parts.append(part)
            target = '/'.join(parts)
            for spec in _names(m.group(1)):
                name, _, local = spec.partition(' as ')
                imports.append((target, name.strip(), (local or name).strip()))
        body = IMPORT.sub('', text)
        exports = [n for m in EXPORT.finditer(body) for n in _names(m.group(1))]
        body = EXPORT.sub('', body)
        bad = FORBIDDEN.search(body)
        if bad:
            line = body[:bad.start()].count('\n') + 1
            raise BundleError('src/app/%s: nicht erlaubte import-/export-Form (Zeile %d nach Entfernen der Importe): %s'
                              % (rel, line, body[bad.start():bad.start() + 60].splitlines()[0]))
        functions = {n for n in exports if re.search(r'^(async )?function\*? ' + re.escape(n) + r'\b', body, re.M)
                     or re.search(r'^const ' + re.escape(n) + r' = (async )?(\([^()]*\)|[\w$]+) =>', body, re.M)}
        mods[rel] = {'imports': imports, 'exports': exports, 'functions': functions, 'body': body}
    return mods


def order(mods):
    for rel, m in mods.items():
        for target, name, _ in m['imports']:
            if target not in mods:
                raise BundleError('src/app/%s importiert aus %s, das es nicht gibt' % (rel, target))
            if name not in mods[target]['exports']:
                raise BundleError('src/app/%s importiert %s aus %s, dort aber nicht exportiert' % (rel, name, target))
    done, result = set(), []
    rest = sorted(r for r in mods if r != LAST)
    while rest:
        ready = [r for r in rest if all(t in done or t == r for t, _, _ in mods[r]['imports'])]
        if not ready:
            # cycle: take the first module whose imports from pending modules are all functions
            ready = [r for r in rest if all(t in done or n in mods[t]['functions'] for t, n, _ in mods[r]['imports'])]
            if not ready:
                lines = ['%s braucht %s' % (r, ', '.join(sorted({'%s aus %s' % (n, t) for t, n, _ in mods[r]['imports']
                         if t not in done and n not in mods[t]['functions']}))) for r in rest]
                raise BundleError('Zyklus aus Werten, den der Build nicht auflösen kann:\n  ' + '\n  '.join(lines))
        pick = ready[0]
        result.append(pick); done.add(pick); rest.remove(pick)
    if LAST in mods:
        result.append(LAST)
    return result


def bundle(app):
    mods = read_modules(app)
    seq = order(mods)
    pos = {r: i for i, r in enumerate(seq)}
    out = ['(() => {\n']
    for rel in seq:
        m = mods[rel]
        out.append('// ===== src/app/%s =====\nconst %s = (() => {\n' % (rel, _var(rel)))
        early, late = {}, []
        for target, name, local in m['imports']:
            if pos[target] < pos[rel]:
                early.setdefault(target, []).append(name if name == local else '%s: %s' % (name, local))
            else:
                if name not in mods[target]['functions']:
                    raise BundleError('src/app/%s: %s aus %s wird erst später geladen und ist keine Funktion' % (rel, name, target))
                late.append('const %s = (...args) => %s.%s(...args);\n' % (local, _var(target), name))
        for target, names in early.items():
            out.append('const { %s } = %s;\n' % (', '.join(names), _var(target)))
        out.extend(late)
        out.append(m['body'])
        if not m['body'].endswith('\n'):
            out.append('\n')
        out.append('return { %s };\n})();\n' % ', '.join(m['exports']))
    out.append('})();\n')
    return ''.join(out), seq
