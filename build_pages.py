"""Prepare the GitHub Pages edition. The local Python server keeps its HTTP transport."""

from pathlib import Path
from shutil import copytree


def build():
    root = Path(__file__).resolve().parent
    output = root / "dist"
    copytree(root / "public", output, dirs_exist_ok=True)
    scripts = ["vendor/peerjs.min.js", "room-engine.js", "classroom.js"]
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
    index.write_text(markup.replace(marker, tags))
    (output / ".nojekyll").touch()


if __name__ == "__main__":
    build()
