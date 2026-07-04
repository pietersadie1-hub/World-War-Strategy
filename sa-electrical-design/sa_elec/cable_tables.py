"""Cable data tables (Aberdare-style, SANS 10142-1 aligned).

IMPORTANT: The figures below are REPRESENTATIVE values in the style of the
Aberdare Cables catalogue / SANS 10142-1 Annex tables for PVC-insulated,
SWA, 600/1000 V multicore cables. Before using this tool for a real design,
verify every figure against the current Aberdare catalogue edition and
SANS 10142-1 amendment in force, and update this module accordingly.

Conventions
-----------
* Current ratings are for the reference conditions of the tables:
  30 degC ambient air, 25 degC ground temperature, soil thermal
  resistivity 1.2 K.m/W, burial depth 0.5 m, single circuit.
* Volt-drop figures are three-phase mV/A/m at conductor operating
  temperature. Single-phase volt drop = three-phase figure * 2/sqrt(3).
"""

from dataclasses import dataclass
from typing import Dict, List, Optional

SQRT3 = 3 ** 0.5

# Installation methods supported by the tables
INSTALL_METHODS = ("air", "conduit", "buried")


@dataclass(frozen=True)
class CableEntry:
    size_mm2: float
    rating_air_a: float      # clipped direct / on tray, touching, 30 degC
    rating_conduit_a: float  # enclosed in conduit / trunking
    rating_buried_a: float   # buried direct in ground
    vd_3ph_mv_per_a_m: float # three-phase volt drop, mV/A/m

    def rating(self, method: str) -> float:
        if method == "air":
            return self.rating_air_a
        if method == "conduit":
            return self.rating_conduit_a
        if method == "buried":
            return self.rating_buried_a
        raise ValueError(f"Unknown installation method: {method!r}")

    @property
    def vd_1ph_mv_per_a_m(self) -> float:
        return self.vd_3ph_mv_per_a_m * 2 / SQRT3


# ---------------------------------------------------------------------------
# PVC SWA multicore, stranded COPPER conductors (70 degC)
# ---------------------------------------------------------------------------
_CU_PVC_SWA: List[CableEntry] = [
    #          size   air  conduit buried  mV/A/m (3ph)
    CableEntry(1.5,    21,    17.5,    27,  29.0),
    CableEntry(2.5,    28,    24,      35,  18.0),
    CableEntry(4,      38,    32,      45,  11.0),
    CableEntry(6,      49,    41,      56,   7.3),
    CableEntry(10,     67,    57,      75,   4.4),
    CableEntry(16,     89,    76,      97,   2.8),
    CableEntry(25,    118,    99,     125,   1.75),
    CableEntry(35,    145,   121,     150,   1.25),
    CableEntry(50,    175,   145,     178,   0.93),
    CableEntry(70,    222,   183,     220,   0.63),
    CableEntry(95,    269,   220,     262,   0.46),
    CableEntry(120,   310,   253,     299,   0.38),
    CableEntry(150,   356,   288,     337,   0.30),
    CableEntry(185,   405,   326,     380,   0.25),
    CableEntry(240,   476,   380,     438,   0.195),
    CableEntry(300,   547,   434,     495,   0.155),
]

# ---------------------------------------------------------------------------
# PVC SWA multicore, stranded ALUMINIUM conductors (70 degC)
# ---------------------------------------------------------------------------
_AL_PVC_SWA: List[CableEntry] = [
    CableEntry(16,     69,    59,     76,    4.5),
    CableEntry(25,     91,    77,     98,    2.9),
    CableEntry(35,    112,    94,    117,    2.1),
    CableEntry(50,    136,   113,    139,    1.55),
    CableEntry(70,    172,   142,    170,    1.05),
    CableEntry(95,    208,   171,    204,    0.76),
    CableEntry(120,   240,   197,    233,    0.62),
    CableEntry(150,   276,   224,    261,    0.50),
    CableEntry(185,   314,   253,    296,    0.41),
    CableEntry(240,   369,   296,    342,    0.32),
    CableEntry(300,   424,   339,    387,    0.26),
]

CABLE_FAMILIES: Dict[str, List[CableEntry]] = {
    "cu_pvc_swa": _CU_PVC_SWA,
    "al_pvc_swa": _AL_PVC_SWA,
}

FAMILY_DESCRIPTIONS = {
    "cu_pvc_swa": "Copper / PVC / SWA / PVC 600/1000 V multicore",
    "al_pvc_swa": "Aluminium / PVC / SWA / PVC 600/1000 V multicore",
}


def get_family(name: str) -> List[CableEntry]:
    try:
        return CABLE_FAMILIES[name]
    except KeyError:
        raise ValueError(
            f"Unknown cable family {name!r}. "
            f"Available: {', '.join(CABLE_FAMILIES)}"
        ) from None


def get_entry(family: str, size_mm2: float) -> Optional[CableEntry]:
    for entry in get_family(family):
        if entry.size_mm2 == size_mm2:
            return entry
    return None


def sizes(family: str) -> List[float]:
    return [e.size_mm2 for e in get_family(family)]


# ---------------------------------------------------------------------------
# Earth-conductor sizing per SANS 10142-1 (table method)
# ---------------------------------------------------------------------------
def min_earth_conductor_mm2(phase_mm2: float) -> float:
    """Minimum earth continuity conductor size for a given phase conductor,
    per the SANS 10142-1 table method (copper).

    <= 16 mm2      : same as phase
    16 < S <= 35   : 16 mm2
    > 35 mm2       : half the phase conductor
    """
    if phase_mm2 <= 16:
        return phase_mm2
    if phase_mm2 <= 35:
        return 16.0
    return phase_mm2 / 2
