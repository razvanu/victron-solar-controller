# Testare, acceptanță și activare — Huawei HA anti-import v2

## Rezultate din 2026-10-13

- HA `check_config`: **valid=true, errors=[]** după instalarea automatizării shadow.
- Execuție live shadow la ~11:06 ora României: **finished**, fără excepții, `HAILEI_CHARGING | P=0W`; SOC Hailei 26%, Huawei 78%, grid ~1W, Hailei +512W, Huawei +554W. Vechea limită Huawei a rămas 0W.
- **12/12 scenarii Jinja simulate trecute**: pornire după 3 tick-uri, încărcare Hailei, încărcare Huawei, SOC 15,4% stop, menținere 16,3% dacă deja activ, 16,3% blocat dacă oprirea fusese declanșată, reactivare 17,2%, export -180W, date invalide, Hailei 9% urgență, 4 cicluri import mic, selector Doar Hailei.
- Noua automatizare de control: **off**, `input_boolean.huawei_v2_permitere_control=off`, vechea automatizare **on**.

**Testele simulate nu sunt echivalente cu un test de transfer energetic real.**

## Teste de acceptanță înainte de activare

1. Într-un interval cu Huawei discharging, verifică `sensor.battery_2_charge_discharge_power`, `sensor.battery_2_bus_current` și contorul `sensor.battery_2_day_discharge`; confirmă semnul negativ al P/I și coherența cu V×I.
2. Testează import grid >250W timp de minimum 90s cu ambele baterii fără încărcare, Huawei SOC >17%, și observă `input_number.huawei_v2_shadow_contor=3` / `shadow_putere` crescând cel mult 200W la 30s.
3. Testează anti-transfer: Hailei charge >120W / >2,5A, Huawei charge >180W / >0,5A, grid export <−150W. Shadow comandă 0W, fără comandă reală.
4. Testează revenirea sub 80W pentru 4 tick-uri, oscilații în jurul pragului și stale sensor >90s.
5. Testează starea de SOC 15,5–17% (simularea verificată); validare fizică numai când e sigur pentru baterie.
6. Observă diagnosticul cel puțin un ciclu zi/noapte și compară cu sistemul existent; în special PV Fronius pe L2 și compensarea trifazată.
7. Înainte de cutover, confirmă PACE CAN CCL/DCL/CVL, ESS minimum SOC 10%, EOD Huawei 15%, `Charge from grid=off`; verifică lipsa scriitorilor suplimentari către numărul Huawei.

## Protocol de cutover (NU a fost executat)

1. Confirmă `input_number.huawei_v2_shadow_putere` valid, curent și fără `DATA_STALE_OR_MISMATCH`; salvează exporturile ambelor automatizări.
2. Pune limita Huawei la **0W** și așteaptă confirmarea; nu modifica protecțiile BMS.
3. Dezactivează **vechea** automatizare prin HA, confirmă starea `off`.
4. Activează **noua** automatizare staged și apoi pune `input_boolean.huawei_v2_permitere_control=on`. Controllerul cere simultan ca vechea automatizare să fie OFF.
5. Verifică traseele HA, import/export Shelly și puterea reală Huawei timp de mai multe cicluri. Dacă ai comportament anormal, aplică rollback imediat.

## Rollback sigur

1. Pune `input_boolean.huawei_v2_permitere_control=off`.
2. **Explicit setează** `number.batteries_maximum_discharging_power_2=0` (oprirea automatizării nu resetează obligatoriu ultima valoare aplicată în invertor).
3. Dezactivează noul controller.
4. Reactivează vechea automatizare și verifică `on` + trace `finished`, fără dual writer.
5. Verifică EOD Huawei 15%, ESS Hailei 10%, BMS PACE nealterat.

**Avertisment:** Nu dezactiva permanent vechea automatizare și nu lăsa noul controller activ înainte de validarea completă a cazurilor de protecție.
