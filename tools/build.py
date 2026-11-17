"""Stamps sw.js with a hash of the app files and optionally copies the deployable files.

  python3 tools/build.py            writes the hash into sw.js in place (run before every commit that changes the app)
  python3 tools/build.py --check    exits with 1 if sw.js does not carry the current hash
  python3 tools/build.py . dist     additionally copies the app to dist/

An installed app only updates when sw.js changes. Without a new hash it keeps showing the cached old index.html.
"""
import hashlib, pathlib, re, shutil, sys

FILES = ['index.html', 'manifest.webmanifest', 'icons/app-192.png', 'icons/app-512.png', 'icons/maskable-512.png', 'icons/apple-180.png']
PATTERN = re.compile(r"const CACHE_VERSION = '([^']*)';")
args = [a for a in sys.argv[1:] if not a.startswith('--')]
src = pathlib.Path(args[0]) if args else pathlib.Path(__file__).resolve().parent.parent

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
