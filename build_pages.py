"""Prepare the GitHub Pages edition. The local Python server keeps its HTTP transport."""

from pathlib import Path
from shutil import copytree
from hashlib import sha256
import re


def build():
    root = Path(__file__).resolve().parent
    output = root / "dist"
    copytree(root / "public", output, dirs_exist_ok=True)
    scripts = ["shared-room.js"]
    for asset in scripts:
        if not (output / asset).is_file():
            raise FileNotFoundError(asset)
    index = output / "index.html"
    markup = index.read_text()
    marker = "<!-- Online room scripts -->"
    if marker not in markup:
        raise ValueError("Missing online room script insertion point")
    markup = markup.replace('<html lang="en">', '<html lang="en" data-hosting="pages">')
    tags = '\n    '.join(f'<script defer src="./{asset}"></script>' for asset in scripts)
    markup = markup.replace(marker, tags)
    # A phone that visited an earlier release must load scripts matching its HTML.
    def versioned(match):
        asset = match.group(1)
        digest = sha256((output / asset).read_bytes()).hexdigest()[:12]
        return f'"./{asset}?v={digest}"'

    index.write_text(re.sub(r'"\./([\w./-]+\.(?:js|css))"', versioned, markup))
    (output / ".nojekyll").touch()


if __name__ == "__main__":
    build()
