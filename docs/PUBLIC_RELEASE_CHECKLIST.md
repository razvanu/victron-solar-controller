# Public release checklist

Use this before changing repository visibility from private to public.

- [ ] `sh tests/check_all.sh` passes.
- [ ] `git diff --check` is clean.
- [ ] README and operational docs match the current flow version.
- [ ] Flow still defaults to DRY RUN.
- [ ] Exactly one DVCC writer exists.
- [ ] No Home Assistant token, Telegram token/chat ID, Node-RED credential file or private LAN address is present.
- [ ] Commit history was checked for previously committed secrets.
- [ ] `.env.example` contains placeholders only.
- [ ] Home Assistant/Solcast entity IDs are documented as reference/example IDs where installation-specific.
- [ ] Solcast API keys and forecast datasets are not included.
- [ ] `LICENSE` is present.
- [ ] GitHub Actions test workflow is present.
- [ ] Public issue/README text makes clear that hardware validation is the user's responsibility.
- [ ] The separate SystemCalc L2 patch is not present.

Changing visibility is a separate administrative action; completing this checklist does not change it automatically.
