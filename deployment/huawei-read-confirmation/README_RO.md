# Confirmarea citirilor Huawei pentru Victron 2.8.11

Corecție locală pentru integrarea Huawei Solar 2.1.5 (sursă: https://github.com/wlcrs/huawei_solar, tag 2.1.5, commit 9738e50280ac5422fdb490d9ed9319071e9a54bf). Fișierele derivate păstrează licența AGPL v3 inclusă în acest director. Nu este o versiune publicată de proiectul Huawei Solar.

SOC-ul constant este normal când bateria nu se descarcă. Ora schimbării valorii în Home Assistant nu dovedește ultima citire hardware. Această corecție confirmă separat fiecare registru SOC/putere returnat de o citire Modbus reală, inclusiv când valoarea rămâne constantă.

Coordinatorul marchează începutul batch-ului, conservator. Atributele senzorilor sunt `huawei_read_protocol=1`, `huawei_read_ok=true`, `huawei_last_successful_read` și `huawei_read_register`. Erorile, timeout-ul, valorile invalide și registrele absente nu produc confirmare. Parserul Node-RED cere această confirmare pentru ambele surse Huawei și păstrează expirarea la 150 s. Nu folosește REST, `last_reported` sau alt senzor drept confirmare.

## Instalare

1. Verifică versiunea 2.1.5 și păstrează copii ale fișierelor instalate. Dacă diferă de sursa 2.1.5, adaptează patch-ul fără a pierde modificările locale.
2. Copiază numai `custom_components/huawei_solar/sensor.py` și `update_coordinator.py` în directorul Huawei Solar din configurația Home Assistant. Alternativ, aplică `huawei-solar-2.1.5.patch`. Nu copia testul în integrarea activă.
3. Repornește Home Assistant cu acordul operatorului. Păstrează controllerul vechi activ și tabul 2.8.11 dezactivat, cu `enableOutputDefault=false`.
4. Verifică în date reale atributele SOC și puterii Huawei: ambele confirmări trebuie să fie valide și timpii să avanseze între citiri, inclusiv la valori constante.
5. Verifică plannerul offline cu datele reale și ieșirea writerului suprimată în DRY RUN. Cere confirmare distinctă înainte de schimbarea taburilor.

Nu importa exportul nou peste întregul set de fluxuri. Păstrează configurația locală, credențialele, celelalte proiecte și calea de salvare a energiei. Folosește API-ul Node-RED v2 cu revizia actuală; la conflict recitește și reconciliază. Trebuie să rămână maximum un writer DVCC și un poller Telegram activ. Patch-ul nu schimbă BMS, ESS sau pragurile PACE.

## Teste

Din rădăcina repository-ului, rulează `sh tests/check_all.sh`. Include testele JS de confirmare și cele 13 teste Python pe metodele modificate cu Modbus simulat. Simulările nu înlocuiesc verificarea live după restart. Fișierele și testele din GitHub nu conțin tokenurile sau backupul local al Node-RED.

## Rollback

Restaurează cele două fișiere Huawei originale, apoi repornește Home Assistant. Păstrează 2.8.11 dezactivat și 2.8.10 activ. După o eventuală comutare, dezactivează întâi noul tab și reactivează vechiul tab în aceeași operație API cu verificarea reviziei. Verifică writerul unic, pollerul unic și salvarea energiei. Nu trimite un backup întreg cu o revizie veche peste modificări concurente.
