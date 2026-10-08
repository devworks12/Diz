#!/usr/bin/env python3
"""ブラウザ（特にスマホの Safari）が古い JS / CSS を使い続けないように、
index.html と js/*.js の中の自分のファイルへの参照に ?v=<版> を付け直す。

    python3 tools/bump_version.py          # 版は今の日時
"""
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
V = time.strftime("%Y%m%d%H%M")

# index.html: css/style.css, js/app.js, manifest
p = ROOT / "index.html"
s = p.read_text()
s = re.sub(r'(href="css/style\.css)(\?v=\w+)?"', rf'\1?v={V}"', s)
s = re.sub(r'(src="js/app\.js)(\?v=\w+)?"', rf'\1?v={V}"', s)
p.write_text(s)

# js/*.js: import ... from './xxx.js' （同じファイルはどこからも同じ URL にする）
for f in (ROOT / "js").glob("*.js"):
    s = f.read_text()
    s2 = re.sub(r"""(from\s+['"]\./[\w.-]+\.js)(\?v=\w+)?(['"])""", rf"\1?v={V}\3", s)
    if s2 != s:
        f.write_text(s2)
print("version", V)
