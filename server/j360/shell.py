"""The app's own files (the "shell"): what the Android app keeps a copy of so it opens without internet."""
import hashlib
import os

_cache = {}


def shell_files(public):
    """Paths, relative to public/, of everything the app needs to start: the page, its styles, scripts, texts and icon."""
    out = ['app.html', 'app.css', 'i18n.js', 'icons.js', 'icon.svg', 'manifest.webmanifest']
    out += sorted('js/' + f for f in os.listdir(os.path.join(public, 'js')) if f.endswith('.js'))
    return [p for p in out if os.path.isfile(os.path.join(public, p))]


def shell_manifest(public):
    """[{path, sha256}] — the app downloads only the files whose fingerprint changed."""
    files = []
    for p in shell_files(public):
        full = os.path.join(public, p)
        key = (full, os.path.getmtime(full), os.path.getsize(full))
        if key not in _cache:
            with open(full, 'rb') as f:
                _cache[key] = hashlib.sha256(f.read()).hexdigest()
        files.append({'path': p, 'sha256': _cache[key]})
    return files
