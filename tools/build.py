import hashlib, pathlib, shutil, sys
src = pathlib.Path(sys.argv[1]); dist = pathlib.Path(sys.argv[2])
if dist.exists(): shutil.rmtree(dist)
dist.mkdir(parents=True)
files = ['index.html', 'manifest.webmanifest', 'icons/app-192.png', 'icons/app-512.png', 'icons/maskable-512.png', 'icons/apple-180.png']
h = hashlib.sha256()
for f in files:
    h.update((src / f).read_bytes())
    (dist / f).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src / f, dist / f)
sw = (src / 'sw.js').read_text(encoding='utf-8')
h.update(sw.encode())
(dist / 'sw.js').write_text(sw.replace('__VERSION__', h.hexdigest()[:16]), encoding='utf-8')
(dist / '.nojekyll').write_text('')
print('version', h.hexdigest()[:16])
