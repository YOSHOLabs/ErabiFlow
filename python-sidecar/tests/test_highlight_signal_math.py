import math
import unittest

from pipeline.highlight_signal_math import robust_prominence, values_in_range, window_peak_mean


class HighlightSignalMathTests(unittest.TestCase):
    def test_prominence_ignores_missing_non_finite_and_flat_values(self) -> None:
        self.assertEqual(robust_prominence([-20.0, -20.0, None, math.nan]), [0.0, 0.0, 0.0, 0.0])

    def test_prominence_only_rewards_values_above_the_baseline(self) -> None:
        result = robust_prominence([1.0, 1.0, 1.0, 8.0])
        self.assertEqual(result[:3], [0.0, 0.0, 0.0])
        self.assertGreater(result[3], 0.9)

    def test_window_peak_mean_keeps_output_aligned_with_input(self) -> None:
        self.assertEqual(window_peak_mean([], [], 1.0), [])
        result = window_peak_mean([0.0, 1.0, 0.0], [0.0, 1.0, 2.0], 0.25)
        self.assertEqual(len(result), 3)
        self.assertGreater(result[1], result[0])

    def test_values_in_range_uses_inclusive_boundaries_and_drops_invalid_values(self) -> None:
        items = [
            {'time': 0.0, 'score': 1.0},
            {'time': 1.0, 'score': math.inf},
            {'time': 2.0, 'score': 3.0},
        ]
        self.assertEqual(values_in_range(items, 0.0, 2.0, 'score', [0.0, 1.0, 2.0]), [1.0, 3.0])


if __name__ == '__main__':
    unittest.main()
