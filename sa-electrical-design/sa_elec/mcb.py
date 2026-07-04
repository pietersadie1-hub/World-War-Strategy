"""MCB / MCCB selection and grading per SANS 556-1 / SANS 60898 / SANS 10142-1.

Selection rule (SANS 10142-1 / IEC 60364-4-43):
    Ib <= In <= Iz
where Ib = design current, In = breaker rating, Iz = derated cable capacity.
For breakers to SANS 60898 the tripping current I2 <= 1.45*In, so satisfying
In <= Iz automatically satisfies I2 <= 1.45*Iz.

Grading (discrimination) in this prototype uses the practical
current-based rule of thumb: an upstream/downstream rating ratio of at
least 1.6:1 (2:1 preferred) for MCB-to-MCB coordination. Full grading
studies need manufacturer time-current curves and let-through energy data.
"""

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

# Standard ratings, SANS 60898 MCBs then common MCCB frames
MCB_RATINGS_A: Tuple[int, ...] = (2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125)
MCCB_RATINGS_A: Tuple[int, ...] = (160, 200, 250, 320, 400, 500, 630, 800)
ALL_RATINGS_A: Tuple[int, ...] = MCB_RATINGS_A + MCCB_RATINGS_A

# Typical breaking capacities available in SA distribution boards (kA)
BREAKING_CAPACITIES_KA: Tuple[float, ...] = (3, 4.5, 6, 10, 15, 25, 36, 50)

CURVE_GUIDE = {
    "B": "Resistive loads, long cable runs (trips 3-5 x In)",
    "C": "General purpose, small motors, lighting banks (5-10 x In)",
    "D": "Motors, transformers, high-inrush loads (10-20 x In)",
}

# Magnetic-trip upper threshold as a multiple of In (worst case per curve)
CURVE_TRIP_MAX = {"B": 5.0, "C": 10.0, "D": 20.0}


@dataclass
class BreakerChoice:
    rating_a: int
    curve: str
    device: str                 # "MCB" or "MCCB"
    breaking_capacity_ka: float
    notes: List[str]


def recommend_curve(load_type: str, starting_current_ratio: float = 1.0) -> str:
    if load_type == "motor":
        return "D" if starting_current_ratio > 5 else "C"
    if load_type in ("lighting", "general"):
        return "C"
    if load_type == "heating":
        return "B"
    return "C"


def select_breaker(design_current_a: float,
                   cable_iz_a: float,
                   load_type: str = "general",
                   fault_level_ka: float = 5.0,
                   starting_current_a: Optional[float] = None) -> Optional[BreakerChoice]:
    """Pick the smallest standard breaker with Ib <= In <= Iz.

    Returns None if no standard rating fits (cable too small for the load).
    """
    notes: List[str] = []
    candidate = None
    for r in ALL_RATINGS_A:
        if r >= design_current_a - 1e-9 and r <= cable_iz_a + 1e-9:
            candidate = r
            break
    if candidate is None:
        return None

    starting_ratio = 1.0
    if starting_current_a:
        starting_ratio = starting_current_a / candidate
    curve = recommend_curve(load_type, starting_ratio)

    if starting_current_a and starting_current_a > CURVE_TRIP_MAX[curve] * candidate:
        notes.append(
            f"Starting current {starting_current_a:.0f} A exceeds the curve-{curve} "
            f"magnetic threshold ({CURVE_TRIP_MAX[curve]:g} x {candidate} A); "
            "consider curve D, a larger rating, or assisted starting."
        )

    # Breaking capacity: smallest standard Icu >= prospective fault current
    icu = next((b for b in BREAKING_CAPACITIES_KA if b >= fault_level_ka), None)
    if icu is None:
        icu = BREAKING_CAPACITIES_KA[-1]
        notes.append(
            f"Prospective fault level {fault_level_ka:g} kA exceeds common "
            "breaker ranges; specify a high-Icu device or current-limiting "
            "back-up protection."
        )

    device = "MCB" if candidate in MCB_RATINGS_A else "MCCB"
    if device == "MCCB":
        notes.append("Rating above 125 A: use an MCCB (adjustable trip preferred).")

    return BreakerChoice(rating_a=candidate, curve=curve, device=device,
                         breaking_capacity_ka=icu, notes=notes)


@dataclass
class GradingStep:
    upstream_a: int
    downstream_a: int
    ratio: float
    ok: bool
    comment: str


def check_grading(chain_ratings_a: Sequence[int],
                  min_ratio: float = 1.6) -> List[GradingStep]:
    """Check current-based discrimination along a chain of breakers.

    `chain_ratings_a` is ordered from the supply side downwards,
    e.g. [250, 100, 63, 20]. Each adjacent pair must have
    upstream/downstream >= min_ratio.
    """
    steps: List[GradingStep] = []
    for up, down in zip(chain_ratings_a, chain_ratings_a[1:]):
        if down <= 0:
            raise ValueError("Breaker ratings must be positive")
        ratio = up / down
        if up <= down:
            ok, comment = False, "Upstream must be larger than downstream."
        elif ratio >= 2.0:
            ok, comment = True, "Good discrimination expected (>= 2:1)."
        elif ratio >= min_ratio:
            ok, comment = True, (
                f"Marginal ({ratio:.2f}:1). Verify with manufacturer "
                "time-current curves."
            )
        else:
            ok, comment = False, (
                f"Ratio {ratio:.2f}:1 below {min_ratio:g}:1 - nuisance "
                "tripping of the upstream device is likely on downstream faults."
            )
        steps.append(GradingStep(up, down, ratio, ok, comment))
    return steps


def suggest_upstream(downstream_a: int, min_ratio: float = 1.6) -> Optional[int]:
    """Smallest standard rating that grades over `downstream_a`."""
    for r in ALL_RATINGS_A:
        if r >= downstream_a * min_ratio:
            return r
    return None
