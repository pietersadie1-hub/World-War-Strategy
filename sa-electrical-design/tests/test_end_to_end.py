import unittest

from sa_elec.calculations import Load
from sa_elec.compliance import CircuitDesign, render_report, verify_circuit
from sa_elec.derating import DeratingInput


class TestEndToEnd(unittest.TestCase):
    def test_buried_motor_feeder(self):
        """15 kW / 400 V motor, 120 m buried run, grouped with one other
        circuit, warm soil - the classic pump-station feeder."""
        circuit = CircuitDesign(
            name="Pump 1",
            load=Load(supply="3ph", voltage_v=400, power_kw=15,
                      power_factor=0.85, efficiency=0.9, load_type="motor"),
            length_m=120,
            derating=DeratingInput(installation="buried", ground_temp_c=30,
                                   grouped_circuits=2, soil_resistivity_kmw=1.5,
                                   burial_depth_m=0.8),
            fault_level_ka=6.0,
            starting_method="dol")
        r = verify_circuit(circuit)

        self.assertTrue(r.compliant)
        self.assertAlmostEqual(r.ib_a, 28.3, delta=0.1)
        # Coordination must hold
        self.assertLessEqual(r.ib_a, r.breaker.rating_a)
        self.assertLessEqual(r.breaker.rating_a, r.iz_a)
        # Volt drop within SANS limit
        self.assertLessEqual(r.volt_drop.percent, 5.0)
        # Long DOL-started run should not land on a tiny cable
        self.assertGreaterEqual(r.cable.size_mm2, 10)

        report = render_report(r)
        self.assertIn("COMPLIANT", report)
        self.assertIn("Pump 1", report)

    def test_volt_drop_forces_upsize(self):
        """Same load, short vs very long route: the long route must select
        a larger conductor purely for volt drop."""
        def run(length):
            return verify_circuit(CircuitDesign(
                name="x",
                load=Load(supply="3ph", voltage_v=400, power_kw=15,
                          power_factor=0.85, efficiency=0.9, load_type="motor"),
                length_m=length))
        short = run(10)
        long = run(300)
        self.assertTrue(short.compliant and long.compliant)
        self.assertGreater(long.cable.size_mm2, short.cable.size_mm2)

    def test_impossible_circuit_reports_failure(self):
        """A huge load on a tiny aluminium family over a long route
        eventually fails cleanly rather than crashing."""
        r = verify_circuit(CircuitDesign(
            name="too big",
            load=Load(supply="3ph", voltage_v=400, current_a=900),
            length_m=500,
            cable_family="al_pvc_swa"))
        self.assertFalse(r.compliant)
        self.assertIsNone(r.cable)
        self.assertIn("FAIL", render_report(r))

    def test_single_phase_lighting(self):
        r = verify_circuit(CircuitDesign(
            name="Lighting DB1",
            load=Load(supply="1ph", voltage_v=230, power_kw=2.0,
                      power_factor=0.95, load_type="lighting"),
            length_m=25,
            derating=DeratingInput(installation="conduit", ambient_air_c=35,
                                   grouped_circuits=4)))
        self.assertTrue(r.compliant)
        self.assertEqual(r.breaker.device, "MCB")

    def test_earth_conductor_rule(self):
        r = verify_circuit(CircuitDesign(
            name="big feeder",
            load=Load(supply="3ph", voltage_v=400, current_a=250),
            length_m=40))
        self.assertIsNotNone(r.cable)
        if r.cable.size_mm2 > 35:
            self.assertAlmostEqual(r.earth_mm2, r.cable.size_mm2 / 2)


if __name__ == "__main__":
    unittest.main()
