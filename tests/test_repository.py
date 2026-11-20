import hashlib
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / "flows" / "Victron_Solar_Forecast_Charge_Controller_v2_8_5.json"

BASE_BRIDGE_SHA256 = "6e3e10b556107d8ecebfe0cb35ea869e0329c6e0f6b7a3dafb5f89ec8e0286c0"
BASE_INSTALL_SHA256 = "669ba0fed1074688dd2d7d4a8dfaea520a71ec5db968da406c455023f940d873"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class RepositoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nodes = json.loads(FLOW.read_text())
        cls.config = next(n for n in cls.nodes if n.get("id") == "2589328ae93145db")

    def test_node_ids_are_unique(self):
        ids = [n.get("id") for n in self.nodes if n.get("id")]
        self.assertEqual(len(ids), len(set(ids)))

    def test_dry_run_default(self):
        self.assertIn("enableOutputDefault: false", self.config["func"])

    def test_commissioning_cap_is_opt_in(self):
        self.assertIn("commissioningChargeCapEnabled: false", self.config["func"])
        guard = next(n for n in self.nodes if n.get("id") == "v282_charge_guard")["func"]
        self.assertIn("cfg.commissioningChargeCapEnabled===true", guard)

    def test_existing_environment_variables_are_preserved(self):
        f = self.config["func"]
        for name in ("SOLAR_HA_TOKEN", "SOLAR_TELEGRAM_TOKEN", "SOLAR_TELEGRAM_CHAT_ID"):
            self.assertIn(name, f)

    def test_local_values_are_sanitized(self):
        text = FLOW.read_text()
        self.assertIn("HOME_ASSISTANT_IP", text)
        self.assertIn("PASTE_TELEGRAM_CHAT_ID", text)

    def test_exactly_one_dvcc_writer(self):
        writers = [
            n for n in self.nodes
            if n.get("type", "").startswith("victron-output")
            and n.get("service") == "com.victronenergy.settings"
            and n.get("path") == "/Settings/SystemSetup/MaxChargeCurrent"
        ]
        self.assertEqual(1, len(writers), writers)
        self.assertEqual("DVCC MaxChargeCurrent — ONLY WRITER", writers[0].get("name"))

    def test_energy_persistence_interval_is_five_minutes(self):
        self.assertIn("energySaveEveryMs: 300000", self.config["func"])
        self.assertIn('energyStateBase: "/data/solar-forecast/daily-energy-v1"', self.config["func"])

    def test_force100_semantics_remain_solar_only_target(self):
        controller = next(n for n in self.nodes if n.get("id") == "c6ab3c4a488844e7")["func"]
        self.assertIn("FORCE100 is a solar-only target, not a current override", controller)


    def test_force_uses_amps_first_and_bypasses_only_soc_taper(self):
        telegram = next(n for n in self.nodes if n.get("id") == "91b32ad72f6b4bae")["func"]
        guard = next(n for n in self.nodes if n.get("id") == "v282_charge_guard")["func"]
        self.assertIn('const amps=Number(args[0]),minutes=', telegram)
        self.assertIn('/force 50 15', telegram)
        self.assertIn("forceBypassSocTaper===true", guard)
        self.assertIn("RAW_MAX_CELL_TAPER", guard)
        self.assertIn("CELL_DELTA_TAPER", guard)

    def test_v285_soc_taper_configuration(self):
        f = self.config["func"]
        for setting in (
            "socTopTaperStartPct: 90",
            "socTopTaperMidPct: 95",
            "socTopTaperTo95A: 20",
            "socTopTaperAbove95A: 15",
            "socTopTaperEndPct: 100",
        ):
            self.assertIn(setting, f)

    def test_bridge_and_installer_match_v284_baseline(self):
        self.assertEqual(BASE_BRIDGE_SHA256, sha256(ROOT / "service" / "bridge.py"))
        self.assertEqual(BASE_INSTALL_SHA256, sha256(ROOT / "service" / "install.sh"))


class V2813FlowTests(unittest.TestCase):
    """Static checks for the v2.8.13 import file (controller tab only)."""

    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "flows" / "Victron_Solar_Forecast_Charge_Controller_v2_8_13.json"
        cls.nodes = json.loads(cls.path.read_text(encoding="utf-8"))
        cls.config = next(n for n in cls.nodes if n.get("id") == "v212_00000004")["func"]

    def test_tab_only_export_with_stable_ids(self):
        tabs = [n for n in self.nodes if n.get("type") == "tab"]
        self.assertEqual(["v212_00000000"], [t["id"] for t in tabs])
        self.assertTrue(all(n.get("z") == "v212_00000000" for n in self.nodes if n.get("type") != "tab"))

    def test_dry_run_and_no_active_restart_by_default(self):
        self.assertIn("enableOutputDefault: false,", self.config)
        self.assertIn("activeAfterRestart: false,", self.config)

    def test_exactly_one_dvcc_writer_and_no_ess_writes(self):
        outputs = [n for n in self.nodes if n.get("type", "").startswith("victron-output")]
        self.assertEqual(1, len(outputs))
        self.assertEqual("/Settings/SystemSetup/MaxChargeCurrent", outputs[0].get("path"))

    def test_installation_values_are_placeholders(self):
        for placeholder in ("HOME_ASSISTANT_IP", "PASTE_LONG_LIVED_ACCESS_TOKEN",
                            "PASTE_TELEGRAM_BOT_TOKEN", "PASTE_TELEGRAM_CHAT_ID"):
            self.assertIn(placeholder, self.config)
        for name in ("SOLAR_HA_TOKEN", "SOLAR_TELEGRAM_TOKEN", "SOLAR_TELEGRAM_CHAT_ID", "SOLAR_HA_URL"):
            self.assertIn(name, self.config)

    def test_new_safety_settings_present(self):
        for setting in ("huaweiDataMaxAgeMs: 120000,", "huaweiDegradedGraceMs: 300000,",
                        "surplusFirstEnabled: true,", 'victronPhase: "L1",', 'huaweiPhase: "L3",',
                        "socTopTaperTo95A: 20,", "rawCellStopV: 3.52,"):
            self.assertIn(setting, self.config)


if __name__ == "__main__":
    unittest.main()
