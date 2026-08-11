"""Pure time-series helpers used by highlight scoring.

This module deliberately knows nothing about transcripts, game rules, model
state, or candidate policy. Keeping these calculations pure makes their edge
cases testable without constructing the scorer pipeline.
"""

import bisect
import math
from collections import deque
from statistics import median
from typing import Optional


def robust_prominence(values: list[Optional[float]]) -> list[float]:
    """Map only values above the median/MAD baseline into the 0..1 range."""
    finite_values = [float(value) for value in values if value is not None and math.isfinite(value)]
    if len(finite_values) < 2:
        return [0.0 for _ in values]

    center = median(finite_values)
    deviations = [abs(value - center) for value in finite_values]
    mad = median(deviations)
    spread = max(finite_values) - min(finite_values)
    if spread <= 1e-9:
        return [0.0 for _ in values]

    scale = max(1.4826 * mad, spread * 0.10, 1e-6)
    result = []
    for value in values:
        if value is None or not math.isfinite(value):
            result.append(0.0)
            continue
        z_score = max(0.0, (float(value) - center) / scale)
        result.append(min(1.0, 1.0 - math.exp(-z_score / 2.0)))
    return result


def window_peak_mean(
    values: list[float],
    centers: list[float],
    half_width: float,
) -> list[float]:
    """Return a peak/mean blend for symmetric windows in O(N)."""
    if not values:
        return []

    result = [0.0] * len(values)
    maximums: deque[int] = deque()
    left = 0
    right = 0
    window_sum = 0.0
    for index, center in enumerate(centers):
        upper = center + half_width
        lower = center - half_width
        while right < len(values) and centers[right] <= upper:
            value = values[right]
            window_sum += value
            while maximums and values[maximums[-1]] <= value:
                maximums.pop()
            maximums.append(right)
            right += 1
        while left < right and centers[left] < lower:
            window_sum -= values[left]
            if maximums and maximums[0] == left:
                maximums.popleft()
            left += 1

        count = max(1, right - left)
        peak = values[maximums[0]] if maximums else 0.0
        result[index] = min(1.0, peak * 0.55 + (window_sum / count) * 0.45)
    return result


def values_in_range(
    items: list[dict],
    start: float,
    end: float,
    key: str,
    times: Optional[list[float]] = None,
) -> list[float]:
    """Read finite values from an inclusive time range, using binary search when possible."""
    values = []
    selected = items
    if times is not None and len(times) == len(items):
        left = bisect.bisect_left(times, start)
        right = bisect.bisect_right(times, end)
        selected = items[left:right]
    for item in selected:
        time_value = item.get('time')
        value = item.get(key)
        if (
            isinstance(time_value, (int, float))
            and start <= float(time_value) <= end
            and isinstance(value, (int, float))
            and math.isfinite(float(value))
        ):
            values.append(float(value))
    return values
