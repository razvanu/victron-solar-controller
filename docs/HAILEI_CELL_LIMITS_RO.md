# Hailei LV51314H: celule, PACE si SOC

Verificare documentara: 2026-10-01. Valorile de mai jos nu certifica configuratia exemplarului instalat.

## Ce este confirmat

- Specificatia EVE MB31, PBRI-MB31-D06-01, versiunea A (noiembrie 2023), tabelul 2, declara 314 Ah si tensiune de sfarsit de incarcare 3.65 V. Tabelul 4 limiteaza tensiunea standard la <=3.65 V/celula. Este un document EVE reprodus de un distribuitor; nu confirma ca fiecare Hailei LV51314H foloseste exact MB31.
- Brosura Hailei pentru LV51200H/LV51314H declara 44.8-57.6 V la nivel de pack. La 16S, 57.6/16=3.60 V este media aritmetica; o celula poate depasi media. Aceasta nu este o instructiune de setare a chargerului la 57.6 V.
- PACE publica P16S150A cu functii SOC si protectie de tensiune, dar pagina publica nu declara pragurile OEM ale Hailei. Documentatia proiectului esphome-pace-bms identifica registre separate pentru Cell OV alarm/protection, Balance start cell/delta voltage si Pack full-charge voltage/current. Registrele disponibile depind de protocol/firmware.
- Nu a fost confirmata o limita universala de delta pentru acest model Hailei. Pragurile software de 50/100 mV sunt ale controlerului, nu valori EVE sau valori PACE citite de pe baterie.

## Modificarea v2.8.6

Treptele max-cell brute sunt 3.45/3.47/3.49 V -> 10/5/2 A; stopul imediat ramane la 3.50 V. Soft ceiling filtrat devine 3.50 V, limitat suplimentar de CVL BMS. Delta, SOC, CCL, watchdog si Grid Guard raman independente.

La max/min 3.469/3.418 V, delta 51 mV continua sa limiteze la 2 A. Nu ridicam delta pentru a ascunde dezechilibrul. Un stop software cu citiri periodice nu garanteaza ca nu vor aparea overshooturi sau alarme BMS.

## SOC 100% si shunt

Un SmartShunt este optional pentru masurare independenta a curentului/energiei si calcul SOC; nu balanseaza celulele. Sincronizarea lui automata la 100% foloseste tensiunea charged voltage, tail current si durata. Nu seta manual 100% pentru a masca o baterie neincarcata. Controlul poate continua sa foloseasca BMS-ul pentru limite si protectii; schimbarea sursei SOC necesita o modificare explicita a flow-ului, care citeste in prezent SOC-ul bateriei selectate.

Pentru calibrare sunt necesare valorile reale PACE: Cell OV alarm/protection/release, Balance start voltage/delta, Pack full-charge voltage/current, capacitate nominala/full si firmware. Nu presupune valori implicite de pe alt PACE. Citirea lor nu autorizeaza modificarea pragurilor BMS.

## Relatari publice

A fost gasita o discutie HaiLei/Solarpro cu Solis despre comunicatie CAN si adrese DIP. Nu este o verificare a pragurilor LV51314H. Nu au fost gasite relatari suficient de documentate pentru a confirma praguri universale de delta sau alarma pentru LV51314H. Serii Hailei diferite sunt promovate cu balansare activa; asta nu confirma balancerul exact din exemplarul de fata.

## Surse

- EVE MB31 (document EVE): https://qion.nl/wp-content/uploads/2024/10/EVE-314Ah-MB31-LiFePO4-Cell-Datasheet.pdf
- Brosura Hailei LV51314H (document Hailei): https://manuals.plus/m/ae5d09262d57f6bbffd4c746ff99d0ede1c8fc3ce844684deaf9227159b90f71.pdf
- PACE P16S150A: https://pacebms.com/en/pd.jsp?fromMid=578&id=14&recommendFromPid=0
- Implementare/protocol PACE: https://github.com/syssi/esphome-pace-bms
- SmartShunt: https://www.victronenergy.com/media/pg/SmartShunt/en/all-features-and-settings.html
- Discutie HaiLei (alta configuratie): https://powerforum.co.za/topic/31647-solis-comms-issue-with-hailei-battery/
