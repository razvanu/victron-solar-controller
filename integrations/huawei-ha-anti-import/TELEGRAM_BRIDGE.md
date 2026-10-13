# Huawei v2 — alerte prin Telegram existent (13 octombrie 2026)

## Arhitectura

Home Assistant -> automatizarea **Huawei v2 - evenimente Telegram prin MQTT (bridge Cerbo)** -> `mqtt.publish` -> Mosquitto -> nodul `mqtt in` din Cerbo Node-RED -> filtrul Huawei v2 -> **nodul existent** `Telegram commands + replies` -> coada/debounce -> `Telegram sendMessage`.

Nu se configureaza un token Telegram nou. Nu se porneste al doilea `getUpdates`; botul Victron continua sa fie unicul poller. Mesajele respecta chat-ul si setarea `/alerts on|off` ale botului existent.

## Ce s-a creat efectiv

- Automatizarea HA `Huawei v2 - evenimente Telegram prin MQTT (bridge Cerbo)` (ID `fb989d3e-d40d-47ec-9480-e0074a2186f0`), **ON**; validare HA fara erori.
- Exportul `telegram-events-automation.json`, pentru audit/reinstalare.
- Fragmentul Node-RED `telegram-bridge-nodered.json`. **Acesta NU este inca instalat in Cerbo**. Pana la importarea lui, MQTT nu genereaza mesaje Telegram.

Automatizarea citeste starea HA, nu comanda invertorul si nu scrie DVCC/BMS.

## Evenimentele trimise

| Event ID | Conditie | Timp minim |
|---|---|---|
| `actual_discharge` | Limita Huawei >200 W SI puterea reala Huawei < -200 W | 30 sec |
| `anti_import_on` | shadow anti-import ON | 30 sec |
| `anti_transfer_block` | shadow `HAILEI_CHARGING` SI import retea >250 W | 60 sec |
| `data_fault` | shadow `DATA_STALE_OR_MISMATCH` | 60 sec |
| `huawei_soc_stop` | SOC Huawei <=15.5% | 30 sec |

Conditie comuna: v2 permitere control ON, automatizarea v2 CONTROL ON, controlul vechi OFF. Triggerele `template` sunt bazate pe frontul FALSE -> TRUE, nu spam la fiecare 30 sec. Bridge-ul mai are un cooldown de 10-20 minute, per eveniment, si respinge mesaje mai vechi de 2 minute.

## Instalare in Cerbo Node-RED (o singura data)

1. Deschideti tabul **Solar Forecast Charge Controller v2.8.10** in Node-RED de pe Cerbo (nu creati un tab separat, deoarece `flow.get('solar_cfg')` si `alerts_enabled` sunt context local de tab).
2. Menu -> Import -> selectati `telegram-bridge-nodered.json` -> import in **current flow**.
3. Deschideti nodul **HA Huawei v2 events (MQTT)**. Selectati un broker MQTT configurat pentru Mosquitto Home Assistant (`192.168.10.50:1883` este adresa de retea HA cunoscuta; verificati port/credentiale MQTT proprii), ori creati configuratia brokerului. Nu salvati parole/token-uri in GitHub.
4. Conectati iesirea nodului **Huawei v2 alert -> internal Telegram** la intrarea **Telegram commands + replies** a controlerului existent, cel care accepta mesajele interne `__alert`. NU conectati direct la `Telegram getUpdates`, `Telegram send request` sau DVCC writer.
5. Deploy **Modified Nodes**. Confirmati ca exista un singur poller `getUpdates` activ si ca botul are `/alerts on`.
6. Test non-perturbator: publicati o singura data un eveniment JSON de test pe topic `home/energy/huawei/v2/events` (cu timestamp Unix curent; `source=huawei_v2_ha`, `event=data_fault`), fara a schimba bateria. Verificati mesajul Telegram si jurnalul nodului; apoi testati triggerul real cand apare.
7. Nu pastrati injectii de test periodice. Nu testati prin modificarea fortata a SOC-urilor sau a limitelor de descărcare.

## Format MQTT

Topic: `home/energy/huawei/v2/events`; QoS 1; retain false. Payload JSON: `source,event,ts,title,h_soc,hu_soc,grid_w,hailei_w,huawei_w,discharge_limit_w,reason`. Nici tokenul botului, nici chat ID-ul nu sunt publicate.

## Verificare si revenire

- In HA, automatizarea Telegram este independenta de controller. Oprirea ei opreste doar publicarea de alerte.
- Nu dezactivati controllerul Huawei v2 pentru o eroare in Telegram; investigati separat.
- Daca Telegram nu livreaza: verificati brokerul si autentificarea MQTT, trace-ul automatizarii HA, filtrul Node-RED, `/alerts on`, precum si statusul transportului Telegram existent. Nu instalati un al doilea `getUpdates` pentru acelasi token.
- Datele provenite din umbra (shadow) sunt estimari. Notificarea de descarcare se bazeaza suplimentar pe puterea masurata; limitarea in W nu dovedeste descarcare efectiva.
