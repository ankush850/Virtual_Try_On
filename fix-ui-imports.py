from pathlib import Path
import re

root = Path(r'C:\Users\Victus\Desktop\Sudesh Fiverr\packages\ui\src')
pattern = re.compile(r"(['\"])(\.[^'\"\r\n]+)(\1)")

for path in root.rglob('*'):
    if path.suffix.lower() not in {'.ts', '.tsx'}:
        continue
    text = path.read_text(encoding='utf-8')
    updated = pattern.sub(lambda m: m.group(1) + m.group(2) + '.js' + m.group(1) if m.group(2).startswith('.') and not m.group(2).endswith(('.js', '.json', '.css')) else m.group(0), text)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

print('patched ui imports')
