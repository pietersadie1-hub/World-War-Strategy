import math
import unittest

from sa_elec.calculations import (
    Load, design_current, motor_starting_current, voltage_drop)


class TestDesignCurrent(unittest.TestCase):
    def test_three_phase_motor(self):
        # 15 kW motor, 400 V, pf 0.85, eff 0.9
        load = Load(supply="3ph", voltage_v=400, power_kw=15,
                    power_factor=0.85, efficiency=0.9, load_type="motor")
        expected = 15000 / (math.sqrt(3) * 400 * 0.85 * 0.9)
        self.assertAlmostEqual(design_current(load), expected, places=3)
        self.assertAlmostEqual(design_current(load), 28.3, delta=0.1)

    def test_single_phase_general(self):
        load = Load(supply="1ph", voltage_v=230, power_kw=3.0, power_factor=1.0)
        self.assertAlmostEqual(design_current(load), 3000 / 230, places=3)

    def test_dc_ignores_pf(self):
        load = Load(supply="dc", voltage_v=220, power_kw=2.2, power_factor=0.5)
        self.assertAlmostEqual(design_current(load), 10.0, places=6)

    def test_efficiency_only_applies_to_motors(self):
        heater = Load(supply="1ph", voltage_v=230, power_kw=2.3, efficiency=0.5,
                      load_type="heating")
        self.assertAlmostEqual(design_current(heater), 10.0, places=6)

    def test_direct_current_input(self):
        load = Load(supply="3ph", voltage_v=400, current_a=42.0)
        self.assertEqual(design_current(load), 42.0)

    def test_requires_exactly_one_of_kw_or_amps(self):
        with self.assertRaises(ValueError):
            Load(supply="3ph", voltage_v=400)
        with self.assertRaises(ValueError):
            Load(supply="3ph", voltage_v=400, power_kw=5, current_a=10)


class TestVoltageDrop(unittest.TestCase):
    def test_three_phase(self):
        # 2.8 mV/A/m, 89 A, 50 m -> 12.46 V on 400 V = 3.115 %
        vd = voltage_drop(2.8, "3ph", 89, 50, 400)
        self.assertAlmostEqual(vd.volts, 12.46, places=2)
        self.assertAlmostEqual(vd.percent, 3.115, places=3)
        self.assertTrue(vd.compliant)

    def test_single_phase_uses_loop_figure(self):
        vd3 = voltage_drop(18.0, "3ph", 20, 30, 400)
        vd1 = voltage_drop(18.0, "1ph", 20, 30, 230)
        self.assertAlmostEqual(vd1.volts, vd3.volts * 2 / math.sqrt(3), places=6)

    def test_limit_flag(self):
        vd = voltage_drop(29.0, "1ph", 20, 60, 230)  # big drop
        self.assertFalse(vd.compliant)


class TestMotorStarting(unittest.TestCase):
    def test_multipliers(self):
        self.assertAlmostEqual(motor_starting_current(30, "dol"), 180)
        self.assertAlmostEqual(motor_starting_current(30, "star-delta"), 60)
        self.assertAlmostEqual(motor_starting_current(30, "vsd"), 45)

    def test_unknown_method(self):
        with self.assertRaises(ValueError):
            motor_starting_current(30, "magic")


if __name__ == "__main__":
    unittest.main()
