import hashlib
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / "flows" / "Victron_Solar_Forecast_Charge_Controller_v2_8_4.json"

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

    def test_bridge_and_installer_match_v284_baseline(self):
        self.assertEqual(BASE_BRIDGE_SHA256, sha256(ROOT / "service" / "bridge.py"))
        self.assertEqual(BASE_INSTALL_SHA256, sha256(ROOT / "service" / "install.sh"))


if __name__ == "__main__":
    unittest.main()
