"""Schreibt den Rechenkern aus index.html nach sim/rf-core.js.

index.html bleibt die einzige Quelle des Rechenkerns (<script id="rf-core">).
Der Simulator (simulator.html) und die Tests laden die erzeugte Kopie.

    python tools/extract_core.py            # sim/rf-core.js neu schreiben
    python tools/extract_core.py --check    # Fehlercode 1, wenn die Kopie veraltet ist
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
match = re.search(r'<script id="rf-core">\n(.*?)</script>', html, re.S)
if not match:
    sys.exit('index.html enthält keinen <script id="rf-core">-Block.')

out = (
    '// ERZEUGT von tools/extract_core.py aus index.html (<script id="rf-core">).\n'
    '// Nicht von Hand ändern: Änderungen in index.html machen und das Skript neu ausführen.\n'
    + match.group(1).rstrip('\n')
    + "\nif (typeof module === 'object' && module.exports) module.exports = RF;\n"
)
target = root / 'sim' / 'rf-core.js'
if '--check' in sys.argv:
    current = target.read_text(encoding='utf-8') if target.exists() else ''
    if current != out:
        sys.exit('sim/rf-core.js ist veraltet. Bitte tools/extract_core.py ausführen.')
    print('sim/rf-core.js ist aktuell.')
else:
    target.parent.mkdir(exist_ok=True)
    target.write_text(out, encoding='utf-8')
    print('geschrieben:', target.relative_to(root), len(out), 'Zeichen')
