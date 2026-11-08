# Mutare MultiPlus + Fronius de pe L2 pe L1 (2026-11-08)

Configuratie noua:
- MultiPlus-II 48/6k5 (Hailei 16 kWh, PACE BMS instanta 512): **L1**.
- Fronius Primo 5 kW pe AC-OUT MultiPlus: **L1** (Venus OS: Settings → Integrations → PV inverters → Fronius → Phase = L1, Position = AC Output).
- Huawei + LUNA 10 kWh: L3 (planificat L2).
- Shelly Pro 3EM: contor NET pe 3 faze, neschimbat.

## Impact asupra controllerului Node-RED (v2.8.12)
Niciunul pe logica. Controllerul foloseste doar NET = L1 + L2 + L3, curentul/tensiunea Hailei, datele BMS 512 si puterea LUNA din HA. Anti-transfer (din v2.8.10) compara puterea bateriei LUNA cu pragul de 50 W si nu depinde de faza pe care sta vreun invertor. Mutarea Huawei pe L2 nu necesita modificari.

## Ce trebuie verificat dupa mutare / dupa update Venus OS
1. **Battery monitor = Hailei 16Kwh (CAN, instanta 512)**, nu BMV-712. Daca BMV-ul este selectat si nu este sincronizat (ex. dupa schimbarea capacitatii), `/Dc/Battery/Soc` din sistem este gol: controllerul cere 0 A (`LIVE_MISSING`), VRM nu afiseaza SOC, iar in HA `sensor.gx_device_dc_battery_charge` devine indisponibil.
   Verificare: `dbus -y com.victronenergy.system /Dc/Battery/Soc GetValue` si `/ActiveBatteryService` → `com.victronenergy.battery/512`.
2. **Semnul Huawei** in CONFIG: `antiTransferHuaweiDischargeSign: -1` (confirmat live 2026-10-15). Valoarea 0 blocheaza Hailei la orice putere LUNA > 50 W.
3. **Patch-ul SystemCalc L2** nu se mai aplica. Update-ul Venus OS il oricum suprascrie.
4. **Capacitatea BMV-712**: LV51314H = 314 Ah. Schimbarea capacitatii reseteaza SOC-ul BMV pana la urmatoarea sincronizare.

## Home Assistant
- `sensor.fronius_5kw_power_l2` este indisponibil dupa mutare; entitatea noua este `sensor.camera_tehnica_fronius_5kw_power_l1`. Automatizarea shadow Huawei v2 a fost actualizata (branch `feature/ha-huawei-anti-import-shadow-v2`).
- Automatizarile AC/FreeDS/boiler folosesc `sensor.fronius_2244371_solar_power` si NET-ul Shelly total: neafectate.
