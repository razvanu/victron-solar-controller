# Testing and release checklist

Arhiva v2.8.4 furnizata nu continea suita istorica de teste simulate. Testele de aici sunt reconstruite ca verificari de regresie pe **codul real din flow**, plus teste ale helperului si verificari statice de repository.

## Rulare

```sh
python3 -m unittest discover -s tests -v
node tests/test_flow_syntax.js
node tests/test_charge_guard.js
python3 tests/secret_scan.py
```

## Ce acopera

- JSON Node-RED valid si ID-uri unice;
- DRY RUN implicit;
- `commissioningChargeCapEnabled: false`;
- variabilele de mediu existente;
- un singur writer DVCC;
- salvare energie la 300000 ms;
- bridge/installer neschimbate fata de baza v2.8.4;
- taper SOC v2.8.5: 90%=20 A, 95%=20 A, >95% porneste la 15 A si scade 12/9/6/3/0 A la 96/97/98/99/100%;
- FORCE bypass SOC taper, dar respecta max-cell/delta;
- parser Telegram: `/force 50 15` = 50 A / 15 minute; `/force 50` = 50 A / 15 minute implicit;
- praguri max-cell 3.40/3.43/3.45 V;
- stop la 3.50 V si delta mare;
- reluare dupa 60 s in zona sigura;
- telemetrie stale -> 0 A;
- commissioning cap numai cu boolean `true`;
- interlock incarcare/descarcare;
- lipsa valorilor locale/secrete cunoscute.

## Inainte de fiecare versiune

1. Ruleaza toate testele.
2. `git diff --check`.
3. `git diff --stat` si inspectie manuala a `git diff`.
4. Confirma ca versiunea porneste in DRY RUN.
5. Confirma ca exista un singur writer DVCC.
6. Ruleaza secret scan.
7. Daca `service/` s-a schimbat, testeaza separat helperul pe Cerbo; o schimbare in GitHub nu il instaleaza automat.
8. Importa flow-ul pe Cerbo numai dupa backup/export al versiunii curente.
9. Pe hardware: verifica `/health`, `/cells`, `/limits`, `/battery` in DRY RUN inainte de `ENABLE CONTROL`.

## Diferenta fata de testele istorice mentionate in README-ul v2.8.4

Documentatia baseline spune ca au existat simulari mai ample pentru charge guard, helper, Telegram si recuperare, dar fisierele acelei suite nu au fost incluse in arhiva. Repository-ul nu pretinde ca le-a recuperat byte-for-byte; le inlocuieste gradual cu teste versionate si reproductibile.
