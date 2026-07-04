import unittest

from sa_elec.derating import DeratingInput, combined_factor


class TestDerating(unittest.TestCase):
    def test_reference_conditions_are_unity(self):
        air = combined_factor(DeratingInput(installation="air"))
        self.assertAlmostEqual(air.total, 1.0, places=6)
        buried = combined_factor(DeratingInput(installation="buried"))
        self.assertAlmostEqual(buried.total, 1.0, places=6)

    def test_hot_ambient_air(self):
        r = combined_factor(DeratingInput(installation="air", ambient_air_c=40))
        self.assertAlmostEqual(r.total, 0.87, places=6)

    def test_interpolation_between_points(self):
        # 37.5 degC is midway between 35 (0.94) and 40 (0.87)
        r = combined_factor(DeratingInput(installation="air", ambient_air_c=37.5))
        self.assertAlmostEqual(r.total, (0.94 + 0.87) / 2, places=6)

    def test_grouping_air(self):
        r = combined_factor(DeratingInput(installation="air", grouped_circuits=3))
        self.assertAlmostEqual(r.total, 0.82, places=6)

    def test_buried_combination(self):
        r = combined_factor(DeratingInput(
            installation="buried", ground_temp_c=30, grouped_circuits=2,
            soil_resistivity_kmw=1.5, burial_depth_m=0.8))
        self.assertAlmostEqual(r.total, 0.94 * 0.85 * 0.93 * 0.97, places=6)
        self.assertEqual(len(r.factors), 4)

    def test_out_of_range_raises(self):
        with self.assertRaises(ValueError):
            combined_factor(DeratingInput(installation="air", ambient_air_c=75))
        with self.assertRaises(ValueError):
            combined_factor(DeratingInput(installation="buried",
                                          grouped_circuits=12))

    def test_below_range_clamps_to_first_entry(self):
        r = combined_factor(DeratingInput(installation="air", ambient_air_c=10))
        self.assertAlmostEqual(r.total, 1.03, places=6)


if __name__ == "__main__":
    unittest.main()
