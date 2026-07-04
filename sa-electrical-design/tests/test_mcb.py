import unittest

from sa_elec.mcb import check_grading, select_breaker, suggest_upstream


class TestSelectBreaker(unittest.TestCase):
    def test_basic_coordination(self):
        # Ib = 28 A, Iz = 45 A -> 32 A breaker fits (28 <= 32 <= 45)
        b = select_breaker(28, 45)
        self.assertEqual(b.rating_a, 32)
        self.assertEqual(b.device, "MCB")

    def test_no_fit_when_cable_too_small(self):
        # Ib = 28 A but Iz = 25 A: no rating satisfies Ib <= In <= Iz
        self.assertIsNone(select_breaker(28, 25))

    def test_motor_gets_c_or_d_curve(self):
        b = select_breaker(28, 60, load_type="motor", starting_current_a=170)
        self.assertIn(b.curve, ("C", "D"))

    def test_high_inrush_motor_gets_d_curve(self):
        b = select_breaker(28, 60, load_type="motor", starting_current_a=200)
        self.assertEqual(b.curve, "D")

    def test_heating_gets_b_curve(self):
        b = select_breaker(10, 30, load_type="heating")
        self.assertEqual(b.curve, "B")

    def test_breaking_capacity_covers_fault_level(self):
        b = select_breaker(28, 60, fault_level_ka=7.5)
        self.assertGreaterEqual(b.breaking_capacity_ka, 7.5)

    def test_mccb_above_125a(self):
        b = select_breaker(150, 300)
        self.assertEqual(b.device, "MCCB")
        self.assertEqual(b.rating_a, 160)


class TestGrading(unittest.TestCase):
    def test_good_chain(self):
        steps = check_grading([250, 100, 40, 20])
        self.assertTrue(all(s.ok for s in steps))

    def test_bad_ratio_flagged(self):
        steps = check_grading([25, 20])
        self.assertFalse(steps[0].ok)

    def test_equal_ratings_fail(self):
        steps = check_grading([63, 63])
        self.assertFalse(steps[0].ok)

    def test_marginal_ratio_passes_with_warning(self):
        steps = check_grading([32, 20])  # 1.6:1 exactly
        self.assertTrue(steps[0].ok)
        self.assertIn("Marginal", steps[0].comment)

    def test_suggest_upstream(self):
        self.assertEqual(suggest_upstream(20), 32)   # 20 * 1.6 = 32
        self.assertEqual(suggest_upstream(63), 125)  # 63 * 1.6 = 100.8


if __name__ == "__main__":
    unittest.main()
