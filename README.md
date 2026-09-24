# victron-solar-controller

Controller Node-RED pentru un sistem Victron ESS care ajusteaza plafonul DVCC `MaxChargeCurrent` pe baza forecastului solar, starii bateriei si puterii NET trifazate. Include un helper Python separat pentru sesiuni temporare de descarcare/export fortat.

**Versiune de baza:** v2.8.4. Flow-ul porneste in **DRY RUN**; activarea controlului se face local in Node-RED. Repository-ul nu instaleaza automat nimic pe Cerbo GX.

## Hardware / runtime validat ca tinta

- Cerbo GX MK2, Venus OS v3.80 Large
- Node-RED 4.1.11
- MultiPlus-II 48/6k5 monofazat pe L2
- Fronius Primo 5 kW pe AC-OUT L2
- Huawei pe celelalte faze
- Hailei 16 kWh, BMS PACE CAN, device instance 512
- Shelly Pro 3EM ca grid meter
- ESS foloseste suma NET L1 + L2 + L3

Testele din repository sunt simulate/statice. Nu reprezinta validare pe hardware real.

## Structura

```text
flows/      exportul Node-RED v2.8.4
service/    helperul Python de descarcare + installer Cerbo
tests/      teste de regresie si verificari de repository
docs/       operare, arhitectura, securitate, testare, provenienta
README.md
CHANGELOG.md
.gitignore
.env.example
```

## Principii de control pastrate

- fara incarcare intentionata din retea;
- DVCC `MaxChargeCurrent` este plafon, nu curent obligatoriu;
- un singur writer DVCC;
- BMS/protectiile celulelor au prioritate, inclusiv la FORCE;
- curent normal 50 A, cu 70/100 A numai conform strategiei existente la SOC scazut;
- `/force100` inseamna tinta SOC 100%, nu 100 A;
- nu se ruleaza simultan doua controlere sau doua pollere Telegram;
- descarcarea fortata foloseste helperul local si override-uri ESS volatile.

## Configuratie si secrete

Nu commit-ui tokenuri, credentiale, IP-uri/identificatori locali sau fisiere Node-RED de credentiale. Flow-ul continua sa suporte:

```text
SOLAR_HA_TOKEN
SOLAR_TELEGRAM_TOKEN
SOLAR_TELEGRAM_CHAT_ID
```

`haUrl` este livrat ca placeholder (`http://HOME_ASSISTANT_IP:8123`) si trebuie configurat local dupa import. `telegramChatId` este placeholder si poate fi furnizat prin `SOLAR_TELEGRAM_CHAT_ID`.

## Verificare inainte de commit / release

```sh
python3 -m unittest discover -s tests -v
node tests/test_flow_syntax.js
node tests/test_charge_guard.js
python3 tests/secret_scan.py
```

Pentru un diff curat fata de ultimul commit:

```sh
git diff --check
git diff --stat
git diff
```

Vezi `docs/TESTING.md` pentru checklist-ul complet si `docs/OPERATIONS_RO.md` pentru instalare/operare.

## Deploy

Modificarile din GitHub **nu sunt instalate automat pe Cerbo**. Exportul Node-RED se importa/deployeaza manual, iar `service/` se copiaza/instaleaza explicit prin SSH numai cand versiunea serviciului se schimba. v2.8.4 pastreaza `bridge.py` si `install.sh` identice cu baza furnizata.

## Scope

Acest repository nu contine si nu modifica patch-ul separat SystemCalc L2 sau alte proiecte Victron/Huawei/Home Assistant.
