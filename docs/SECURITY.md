# Security and public-repository hygiene

## Never commit

- Home Assistant Long-Lived Access Tokens;
- Telegram bot tokens;
- real Telegram owner/chat IDs;
- Node-RED credential files;
- private LAN addresses/hostnames unless intentionally public;
- battery/inverter serial numbers or other installation identifiers that are not required by the project;
- `.env` or local configuration files containing credentials;
- raw Solcast API keys or downloaded/private Solcast forecast datasets.

## Supported environment variables

```text
SOLAR_HA_TOKEN
SOLAR_TELEGRAM_TOKEN
SOLAR_TELEGRAM_CHAT_ID
```

`.env` variants are ignored by Git. `.env.example` contains placeholders only.

The committed flow uses:

```text
http://HOME_ASSISTANT_IP:8123
PASTE_LONG_LIVED_ACCESS_TOKEN
PASTE_TELEGRAM_BOT_TOKEN
PASTE_TELEGRAM_CHAT_ID
```

Replace them only in a local copy or through environment variables.

## Before every public release

Run:

```sh
sh tests/check_all.sh
```

Then inspect manually:

```sh
git grep -nEi 'token|password|secret|chat.?id|authorization|bearer|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.'
```

Expected documentation/placeholders must be reviewed; do not blindly suppress matches.

Also inspect commit history, not just the current working tree. If a real credential was committed at any point, deleting it in a later commit is not enough: rotate/revoke the credential and remove it from history before publication.

## Home Assistant token scope

The flow currently uses a Home Assistant Long-Lived Access Token to read `/api/states`. Treat that token like a password. Prefer a dedicated Home Assistant user/account appropriate for automation rather than reusing an unrelated personal token.

## Solcast data and terms

The project integrates with forecast values exposed by Home Assistant but does not redistribute Solcast forecast data or credentials. Users remain responsible for complying with the terms and quota of their Solcast account.

Current upstream information:
- https://www.solcast.com/free-rooftop-solar-forecasting
- https://solcast.com/terms-of-use

## Telegram

Mutation commands are accepted only from the configured private owner chat. The bot token and owner/chat ID must never be published.

## Network exposure

The project does not require Home Assistant, Node-RED or the Cerbo GX to be directly exposed to the public Internet. Keep management interfaces behind a trusted LAN/VPN and follow the security guidance of each upstream platform.
