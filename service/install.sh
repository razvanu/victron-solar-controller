#!/bin/sh
set -eu
[ "$(id -u)" = 0 ] || { echo 'Ruleaza ca root pe Cerbo.'; exit 1; }
id nodered >/dev/null
python3 -c 'import dbus, socket, fcntl'
[ -d /service ] || { echo '/service lipseste: instalare oprita.'; exit 1; }
command -v svc >/dev/null || { echo 'svc lipseste: instalare oprita.'; exit 1; }
SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DST=/data/solar-discharge
if [ -e /service/solar-discharge ] || [ -L /service/solar-discharge ]; then
 [ "$(readlink -f /service/solar-discharge)" = "$DST/service" ] || { echo 'Exista alt serviciu solar-discharge: instalare oprita.'; exit 1; }
fi
# A manual stop first releases an existing session when upgrading.
if [ -f "$DST/bridge.py" ]; then
 python3 "$DST/bridge.py" client eyJhY3Rpb24iOiJzdG9wIn0
fi
if [ -e /service/solar-discharge ]; then
 svc -d /service/solar-discharge
fi
mkdir -p "$DST/service"
if [ "$SRC/bridge.py" != "$DST/bridge.py" ]; then cp "$SRC/bridge.py" "$DST/bridge.py"; fi
chmod 755 "$DST" "$DST/service" "$DST/bridge.py"
cat > "$DST/service/run" <<'EOF'
#!/bin/sh
exec python3 -u /data/solar-discharge/bridge.py daemon
EOF
chmod 755 "$DST/service/run"
cat > "$DST/start.sh" <<'EOF'
#!/bin/sh
if [ ! -e /service/solar-discharge ]; then
 ln -s /data/solar-discharge/service /service/solar-discharge
fi
svc -u /service/solar-discharge
EOF
chmod 755 "$DST/start.sh"
# Insert before an existing 'exit 0', preserving all other boot customizations.
python3 - <<'PY'
from pathlib import Path
import shutil
p=Path('/data/rc.local')
line='/data/solar-discharge/start.sh # solar-discharge-watchdog'
s=p.read_text() if p.exists() else '#!/bin/sh\n'
if line not in s:
 if p.exists():shutil.copy2(p,str(p)+'.before-solar-discharge')
 rows=s.splitlines();at=next((i for i,r in enumerate(rows) if r.strip()=='exit 0'),len(rows));rows.insert(at,line)
 p.write_text('\n'.join(rows)+'\n');p.chmod(0o755)
PY
"$DST/start.sh"
echo 'Instalat. Nu a pornit nicio descarcare. Verifica /discharge status dupa importul flow-ului.'
