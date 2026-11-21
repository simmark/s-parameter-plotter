"""Assembles index.html from src/, stamps sw.js with a hash of the app files and optionally copies the deployable files.

  python3 tools/build.py            writes index.html from src/ and the hash into sw.js (run before every commit that changes the app)
  python3 tools/build.py --check    exits with 1 if index.html does not match src/ or sw.js does not carry the current hash
  python3 tools/build.py . dist     additionally copies the app to dist/

The source lives in src/: index.src.html is the page skeleton, every line '@@include path@@' is replaced by the file src/path.
index.html stays a committed, generated file because GitHub Pages serves it as it is. Edit src/, never index.html.
An installed app only updates when sw.js changes. Without a new hash it keeps showing the cached old index.html.
"""
import hashlib, pathlib, re, shutil, sys

FILES = ['index.html', 'manifest.webmanifest', 'icons/app-192.png', 'icons/app-512.png', 'icons/maskable-512.png', 'icons/apple-180.png']
PATTERN = re.compile(r"const CACHE_VERSION = '([^']*)';")
args = [a for a in sys.argv[1:] if not a.startswith('--')]
src = pathlib.Path(args[0]) if args else pathlib.Path(__file__).resolve().parent.parent

INCLUDE = re.compile(r'^@@include (\S+)@@\n?$')

def assemble(src):
    """index.html as text, built from src/index.src.html. Fails on a missing file or on a file nothing includes."""
    base = src / 'src'
    used, out = set(), []
    for line in re.findall(r'[^\n]*\n|[^\n]+', (base / 'index.src.html').read_bytes().decode('utf-8')):
        m = INCLUDE.match(line)
        if not m:
            out.append(line)
            continue
        name = m.group(1)
        if name in used:
            raise SystemExit('src/%s wird mehrfach eingebunden' % name)
        used.add(name)
        out.append((base / name).read_bytes().decode('utf-8'))
    unused = sorted(str(p.relative_to(base)) for p in base.rglob('*') if p.is_file() and p.name != 'index.src.html' and str(p.relative_to(base)) not in used)
    if unused:
        raise SystemExit('Dateien in src/, die index.src.html nicht einbindet: ' + ', '.join(unused))
    return ''.join(out)

html = assemble(src)
index = src / 'index.html'
index_current = index.read_bytes().decode('utf-8') if index.exists() else None
if '--check' not in sys.argv and index_current != html:
    index.write_bytes(html.encode('utf-8'))
    print('index.html aus src/ neu geschrieben')
if '--check' in sys.argv and index_current != html:
    print('index.html passt nicht zu src/: python3 tools/build.py ausführen')
    sys.exit(1)

h = hashlib.sha256()
for f in FILES:
    h.update((src / f).read_bytes())
sw_path = src / 'sw.js'
sw = sw_path.read_text(encoding='utf-8')
h.update(PATTERN.sub("const CACHE_VERSION = '';", sw).encode())
version = h.hexdigest()[:16]
current = PATTERN.search(sw).group(1)

if '--check' in sys.argv:
    print('sw.js', 'aktuell' if current == version else 'VERALTET: ' + current + ' statt ' + version)
    sys.exit(0 if current == version else 1)
if current != version:
    sw_path.write_text(PATTERN.sub("const CACHE_VERSION = '" + version + "';", sw), encoding='utf-8')
print('version', version)

if len(args) > 1:
    dist = pathlib.Path(args[1])
    if dist.exists():
        shutil.rmtree(dist)
    for f in FILES + ['sw.js', 'LICENSE.txt']:
        (dist / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / f, dist / f)
    (dist / '.nojekyll').write_text('')
