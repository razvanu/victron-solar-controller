# Security and secret handling

## Nu se commit-ui

- token Home Assistant;
- token Telegram;
- Telegram owner/chat ID real;
- credentiale Node-RED;
- adrese IP/LAN sau alte date locale care nu sunt necesare proiectului;
- exporturi locale care contin credentiale.

## Variabile suportate

```text
SOLAR_HA_TOKEN
SOLAR_TELEGRAM_TOKEN
SOLAR_TELEGRAM_CHAT_ID
```

`.env` si variantele lui sunt ignorate de Git. `.env.example` contine doar valori fictive.

## Inainte de primul push

Ruleaza:

```sh
python3 tests/secret_scan.py
```

Apoi verifica manual:

```sh
git grep -nEi 'token|password|secret|chat.?id|authorization|bearer|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.'
```

Rezultatele legitime din documentatie/placeholdere trebuie inspectate, nu ignorate automat.

Daca un secret real a fost commit-uit vreodata, simpla stergere intr-un commit ulterior nu este suficienta: secretul trebuie rotit si istoricul curatat inainte de publicare/partajare.
