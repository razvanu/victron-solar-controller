import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# service/bridge.py runs only on Venus OS (Linux) and imports POSIX-only modules
# (fcntl, pwd). CI (ubuntu) always runs these tests; a Windows workstation skips them.
POSIX = importlib.util.find_spec("fcntl") is not None
bridge = None
if POSIX:
    spec = importlib.util.spec_from_file_location("bridge", ROOT / "service" / "bridge.py")
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)


@unittest.skipUnless(POSIX, "service/bridge.py needs POSIX fcntl/pwd (Venus OS); runs in CI on Linux")
class BridgeUnitTests(unittest.TestCase):
    def test_numeric_rejects_non_numeric_telemetry(self):
        for value in (None, True, False, "3.2", [], {}):
            with self.assertRaises(ValueError):
                bridge.numeric(value)

    def test_numeric_accepts_finite_numbers(self):
        self.assertEqual(3.2, bridge.numeric(3.2))
        self.assertEqual(5.0, bridge.numeric(5))

    def test_same_uses_half_unit_tolerance(self):
        self.assertTrue(bridge.same(None, None))
        self.assertTrue(bridge.same(100, 100.49))
        self.assertFalse(bridge.same(100, 100.5))

    def test_lease_is_15_seconds(self):
        self.assertEqual(15.0, bridge.LEASE)

    def test_override_paths_are_expected(self):
        self.assertEqual("/Overrides/Setpoint", bridge.SP)
        self.assertEqual("/Overrides/MaxDischargePower", bridge.MP)


if __name__ == "__main__":
    unittest.main()
