"""Load-current and voltage-drop calculations (SANS 10142-1 aligned)."""

from dataclasses import dataclass
from typing import Optional

SQRT3 = 3 ** 0.5

# SANS 10142-1: max volt drop between the point of supply and any point of
# consumption is 5 % of the standard (nominal) voltage.
SANS_MAX_VD_PERCENT = 5.0

SUPPLY_TYPES = ("dc", "1ph", "3ph")

STANDARD_VOLTAGES = {
    "1ph": (230.0,),
    "3ph": (400.0, 525.0, 690.0),
    "dc": (110.0, 220.0, 48.0, 24.0),
}


@dataclass
class Load:
    """A connected load.

    Specify EITHER power_kw (mechanical output for motors, electrical input
    otherwise) OR current_a directly.
    """
    supply: str                      # "dc" | "1ph" | "3ph"
    voltage_v: float
    power_kw: Optional[float] = None
    current_a: Optional[float] = None
    power_factor: float = 1.0        # ignored for DC
    efficiency: float = 1.0          # motor efficiency; 1.0 for non-motors
    load_type: str = "general"       # "general" | "motor" | "lighting" | "heating"

    def __post_init__(self):
        if self.supply not in SUPPLY_TYPES:
            raise ValueError(f"supply must be one of {SUPPLY_TYPES}")
        if (self.power_kw is None) == (self.current_a is None):
            raise ValueError("Specify exactly one of power_kw or current_a")
        if self.voltage_v <= 0:
            raise ValueError("voltage_v must be positive")
        if not 0 < self.power_factor <= 1:
            raise ValueError("power_factor must be in (0, 1]")
        if not 0 < self.efficiency <= 1:
            raise ValueError("efficiency must be in (0, 1]")


def design_current(load: Load) -> float:
    """Design current Ib in amps.

    Motors: Ib = P / (k * V * pf * eff)  (P = rated mechanical output)
    Other : Ib = P / (k * V * pf)
    where k = sqrt(3) for 3-phase, 1 otherwise.
    """
    if load.current_a is not None:
        return load.current_a

    p_w = load.power_kw * 1000.0
    k = SQRT3 if load.supply == "3ph" else 1.0
    pf = 1.0 if load.supply == "dc" else load.power_factor
    eff = load.efficiency if load.load_type == "motor" else 1.0
    return p_w / (k * load.voltage_v * pf * eff)


@dataclass
class VoltDrop:
    volts: float
    percent: float
    limit_percent: float = SANS_MAX_VD_PERCENT

    @property
    def compliant(self) -> bool:
        return self.percent <= self.limit_percent + 1e-9


def voltage_drop(mv_per_a_m_3ph: float, supply: str, current_a: float,
                 length_m: float, voltage_v: float,
                 limit_percent: float = SANS_MAX_VD_PERCENT) -> VoltDrop:
    """Voltage drop from a table mV/A/m figure (three-phase basis).

    Single-phase and DC circuits use the 3-phase figure * 2/sqrt(3)
    (i.e. the go-and-return loop value), which is how the two-core
    columns of the tables are derived.
    """
    if supply == "3ph":
        mvam = mv_per_a_m_3ph
    else:
        mvam = mv_per_a_m_3ph * 2 / SQRT3
    vd = mvam * current_a * length_m / 1000.0
    return VoltDrop(volts=vd, percent=100.0 * vd / voltage_v,
                    limit_percent=limit_percent)


def motor_starting_current(flc_a: float, method: str = "dol") -> float:
    """Approximate motor starting current.

    dol        : 6 x FLC (typical 5-8)
    star-delta : 2 x FLC (about a third of DOL)
    soft / vsd : 1.5 x FLC
    """
    multipliers = {"dol": 6.0, "star-delta": 2.0, "soft": 1.5, "vsd": 1.5}
    try:
        return flc_a * multipliers[method]
    except KeyError:
        raise ValueError(
            f"Unknown starting method {method!r}; "
            f"use one of {', '.join(multipliers)}"
        ) from None
