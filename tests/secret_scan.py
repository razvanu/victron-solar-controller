#!/usr/bin/env python3
import ipaddress
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'.git'}

patterns = [
    ('telegram bot token', re.compile(r'\b\d{6,12}:[A-Za-z0-9_-]{30,}\b')),
    ('github token', re.compile(r'\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b')),
    ('generic bearer token', re.compile(r'Authorization["\']?\s*[:=].{0,40}Bearer\s+[A-Za-z0-9._~-]{20,}', re.I)),
    ('numeric Telegram chat id in flow config', re.compile(r'telegramChatId\s*:\s*-?\d{5,}')),
]
ipv4 = re.compile(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')

failures=[]
for p in ROOT.rglob('*'):
    if not p.is_file() or any(part in EXCLUDED for part in p.parts):
        continue
    try:
        text=p.read_text(errors='strict')
    except Exception:
        continue
    rel=p.relative_to(ROOT)
    for name,rx in patterns:
        if rx.search(text): failures.append(f'{rel}: possible {name}')
    # Local RFC1918 addresses are not repository configuration. Documentation may
    # mention localhost/unspecified addresses, which are intentionally ignored.
    for raw in ipv4.findall(text):
        try: addr=ipaddress.ip_address(raw)
        except ValueError: continue
        if addr.version == 4 and addr.is_private and not addr.is_loopback and not addr.is_unspecified:
            failures.append(f'{rel}: private IPv4 address present')

if failures:
    print('SECRET/LOCAL-DATA SCAN FAILED')
    for f in sorted(set(failures)): print(' -',f)
    sys.exit(1)
print('PASS: no high-signal secrets, numeric Telegram owner ID, or private IPv4 addresses found')
