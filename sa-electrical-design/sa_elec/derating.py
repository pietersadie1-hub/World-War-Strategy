"""Derating (correction) factors per SANS 10142-1 / IEC 60364-5-52 style tables.

The values are representative of the correction tables published in
SANS 10142-1 and manufacturer catalogues for PVC (70 degC) insulation.
Verify against the standard / catalogue edition in force before real use.

All factors multiply the tabulated current rating:
    Iz = I_table * Ca * Cg * Cs * Cd
"""

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

# --- Ambient AIR temperature (reference 30 degC), PVC 70 degC ---------------
AMBIENT_AIR_PVC: Dict[int, float] = {
    25: 1.03, 30: 1.00, 35: 0.94, 40: 0.87,
    45: 0.79, 50: 0.71, 55: 0.61, 60: 0.50,
}

# --- GROUND temperature (reference 25 degC), PVC 70 degC --------------------
GROUND_TEMP_PVC: Dict[int, float] = {
    20: 1.05, 25: 1.00, 30: 0.94, 35: 0.89,
    40: 0.84, 45: 0.77, 50: 0.71,
}

# --- Grouping: multicore cables touching, single layer in air / on tray -----
GROUPING_AIR: Dict[int, float] = {
    1: 1.00, 2: 0.88, 3: 0.82, 4: 0.77, 5: 0.75,
    6: 0.73, 7: 0.73, 8: 0.72, 9: 0.72,
}

# --- Grouping: cables buried direct, touching --------------------------------
GROUPING_BURIED: Dict[int, float] = {
    1: 1.00, 2: 0.85, 3: 0.75, 4: 0.70, 5: 0.65, 6: 0.60,
}

# --- Soil thermal resistivity (reference 1.2 K.m/W) --------------------------
SOIL_RESISTIVITY: Dict[float, float] = {
    0.8: 1.14, 1.0: 1.07, 1.2: 1.00, 1.5: 0.93,
    2.0: 0.84, 2.5: 0.77, 3.0: 0.71,
}

# --- Depth of burial (reference 0.5 m) ---------------------------------------
BURIAL_DEPTH: Dict[float, float] = {
    0.5: 1.00, 0.8: 0.97, 1.0: 0.95, 1.25: 0.93, 1.5: 0.91,
}


def _lookup(table: Dict, key: float, name: str, *, interpolate: bool = True) -> float:
    """Look up a factor, linearly interpolating between tabulated points.

    Values below the table range use the first (most favourable end)
    tabulated factor; values above the range raise, because extrapolating
    a derating table is unsafe.
    """
    keys = sorted(table)
    if key in table:
        return table[key]
    if key < keys[0]:
        return table[keys[0]]
    if key > keys[-1]:
        raise ValueError(
            f"{name} = {key} is outside the tabulated range "
            f"({keys[0]}..{keys[-1]}); a special design review is required."
        )
    if not interpolate:
        # snap to the more conservative (next-higher key) entry
        for k in keys:
            if k > key:
                return table[k]
    lo = max(k for k in keys if k <= key)
    hi = min(k for k in keys if k >= key)
    frac = (key - lo) / (hi - lo)
    return table[lo] + frac * (table[hi] - table[lo])


@dataclass
class DeratingInput:
    installation: str = "air"          # "air" | "conduit" | "buried"
    ambient_air_c: float = 30.0        # used for air / conduit
    ground_temp_c: float = 25.0        # used for buried
    grouped_circuits: int = 1
    soil_resistivity_kmw: float = 1.2  # used for buried
    burial_depth_m: float = 0.5        # used for buried


@dataclass
class DeratingResult:
    total: float
    factors: List[Tuple[str, float]] = field(default_factory=list)


def combined_factor(inp: DeratingInput) -> DeratingResult:
    """Combine all applicable correction factors for the installation."""
    factors: List[Tuple[str, float]] = []

    if inp.installation == "buried":
        factors.append((
            f"Ground temperature {inp.ground_temp_c:g} degC",
            _lookup(GROUND_TEMP_PVC, inp.ground_temp_c, "Ground temperature"),
        ))
        factors.append((
            f"Grouping ({inp.grouped_circuits} buried circuit(s))",
            _lookup(GROUPING_BURIED, inp.grouped_circuits, "Buried grouping",
                    interpolate=False),
        ))
        factors.append((
            f"Soil thermal resistivity {inp.soil_resistivity_kmw:g} K.m/W",
            _lookup(SOIL_RESISTIVITY, inp.soil_resistivity_kmw,
                    "Soil thermal resistivity"),
        ))
        factors.append((
            f"Burial depth {inp.burial_depth_m:g} m",
            _lookup(BURIAL_DEPTH, inp.burial_depth_m, "Burial depth"),
        ))
    else:  # air or conduit
        factors.append((
            f"Ambient air {inp.ambient_air_c:g} degC",
            _lookup(AMBIENT_AIR_PVC, inp.ambient_air_c, "Ambient air temperature"),
        ))
        factors.append((
            f"Grouping ({inp.grouped_circuits} circuit(s))",
            _lookup(GROUPING_AIR, inp.grouped_circuits, "Grouping",
                    interpolate=False),
        ))

    total = 1.0
    for _, f in factors:
        total *= f
    return DeratingResult(total=total, factors=factors)
