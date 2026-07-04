"""End-to-end design verification and compliance reporting.

Sizing procedure (SANS 10142-1 / IEC 60364 coordination rules):
  1. Ib  = design current of the load
  2. In  = smallest standard breaker rating >= Ib
  3. Iz  = tabulated cable rating x combined derating factor
           Require Iz >= In  (which also guarantees I2 = 1.45*In <= 1.45*Iz)
  4. Volt drop over the route length <= 5 % of nominal voltage
     (upsize the cable until it passes)
  5. Earth conductor from the SANS table method
"""

from dataclasses import dataclass, field
from typing import List, Optional

from . import cable_tables, derating, calculations, mcb
from .cable_tables import CableEntry
from .calculations import Load, VoltDrop
from .derating import DeratingInput, DeratingResult
from .mcb import BreakerChoice


@dataclass
class CircuitDesign:
    """Inputs for one circuit."""
    name: str
    load: Load
    length_m: float
    cable_family: str = "cu_pvc_swa"
    derating: DeratingInput = field(default_factory=DeratingInput)
    fault_level_ka: float = 5.0
    starting_method: Optional[str] = None      # motors: dol / star-delta / soft / vsd
    vd_limit_percent: float = calculations.SANS_MAX_VD_PERCENT


@dataclass
class DesignResult:
    circuit: CircuitDesign
    ib_a: float
    derate: DeratingResult
    cable: Optional[CableEntry]
    iz_a: Optional[float]
    breaker: Optional[BreakerChoice]
    volt_drop: Optional[VoltDrop]
    earth_mm2: Optional[float]
    checks: List[tuple] = field(default_factory=list)   # (description, passed, detail)
    compliant: bool = False


def verify_circuit(c: CircuitDesign) -> DesignResult:
    ib = calculations.design_current(c.load)
    dr = derating.combined_factor(c.derating)

    starting_a = None
    if c.load.load_type == "motor" and c.starting_method:
        starting_a = calculations.motor_starting_current(ib, c.starting_method)

    method = c.derating.installation
    chosen_cable: Optional[CableEntry] = None
    chosen_iz: Optional[float] = None
    chosen_breaker: Optional[BreakerChoice] = None
    chosen_vd: Optional[VoltDrop] = None

    for entry in cable_tables.get_family(c.cable_family):
        iz = entry.rating(method) * dr.total
        breaker = mcb.select_breaker(
            ib, iz, load_type=c.load.load_type,
            fault_level_ka=c.fault_level_ka, starting_current_a=starting_a)
        if breaker is None:
            continue  # cable cannot carry a breaker >= Ib
        vd = calculations.voltage_drop(
            entry.vd_3ph_mv_per_a_m, c.load.supply, ib,
            c.length_m, c.load.voltage_v, c.vd_limit_percent)
        if not vd.compliant:
            continue  # upsize for volt drop
        chosen_cable, chosen_iz, chosen_breaker, chosen_vd = entry, iz, breaker, vd
        break

    result = DesignResult(
        circuit=c, ib_a=ib, derate=dr,
        cable=chosen_cable, iz_a=chosen_iz,
        breaker=chosen_breaker, volt_drop=chosen_vd,
        earth_mm2=(cable_tables.min_earth_conductor_mm2(chosen_cable.size_mm2)
                   if chosen_cable else None),
    )

    checks = result.checks
    if chosen_cable is None:
        checks.append((
            "Cable selection", False,
            "No cable in the selected family satisfies both the current-carrying "
            "and volt-drop requirements. Consider parallel cables, a larger "
            "family, a higher supply voltage, or a shorter route."))
        result.compliant = False
        return result

    checks.append((
        "Coordination Ib <= In <= Iz", True,
        f"{ib:.1f} A <= {chosen_breaker.rating_a} A <= {chosen_iz:.1f} A"))
    checks.append((
        f"Volt drop <= {c.vd_limit_percent:g} % (SANS 10142-1)",
        chosen_vd.compliant,
        f"{chosen_vd.volts:.2f} V = {chosen_vd.percent:.2f} % over {c.length_m:g} m"))
    checks.append((
        "Breaking capacity >= fault level",
        chosen_breaker.breaking_capacity_ka >= c.fault_level_ka,
        f"Icu {chosen_breaker.breaking_capacity_ka:g} kA vs "
        f"{c.fault_level_ka:g} kA prospective"))
    result.compliant = all(ok for _, ok, _ in checks)
    return result


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------
def render_report(r: DesignResult) -> str:
    c = r.circuit
    load = c.load
    lines: List[str] = []
    add = lines.append

    add("=" * 68)
    add(f"SANS 10142-1 DESIGN VERIFICATION - {c.name}")
    add("=" * 68)
    add("")
    add("1. LOAD")
    supply_desc = {"dc": "DC", "1ph": "AC single-phase", "3ph": "AC three-phase"}
    add(f"   Supply             : {supply_desc[load.supply]}, {load.voltage_v:g} V")
    if load.power_kw is not None:
        add(f"   Rated power        : {load.power_kw:g} kW"
            f"  (pf {load.power_factor:g}, eff {load.efficiency:g})")
    add(f"   Load type          : {load.load_type}")
    add(f"   Design current Ib  : {r.ib_a:.1f} A")
    if load.load_type == "motor" and c.starting_method:
        start = calculations.motor_starting_current(r.ib_a, c.starting_method)
        add(f"   Starting current   : ~{start:.0f} A ({c.starting_method} start)")
    add(f"   Route length       : {c.length_m:g} m")
    add("")

    add("2. DERATING FACTORS")
    for desc, f in r.derate.factors:
        add(f"   {desc:<42}: {f:.2f}")
    add(f"   {'Combined factor':<42}: {r.derate.total:.3f}")
    add("")

    add("3. CABLE SELECTION "
        f"({cable_tables.FAMILY_DESCRIPTIONS[c.cable_family]}, "
        f"installed: {c.derating.installation})")
    if r.cable:
        add(f"   Selected size      : {r.cable.size_mm2:g} mm2")
        add(f"   Table rating       : {r.cable.rating(c.derating.installation):g} A")
        add(f"   Derated rating Iz  : {r.iz_a:.1f} A")
        add(f"   Volt drop          : {r.volt_drop.volts:.2f} V "
            f"({r.volt_drop.percent:.2f} %)")
        add(f"   Min earth conductor: {r.earth_mm2:g} mm2 (Cu, table method)")
    else:
        add("   NO SUITABLE CABLE FOUND IN FAMILY")
    add("")

    add("4. PROTECTION")
    if r.breaker:
        b = r.breaker
        add(f"   Device             : {b.rating_a} A {b.device}, curve {b.curve}, "
            f"Icu {b.breaking_capacity_ka:g} kA")
        add(f"   Curve guide        : {mcb.CURVE_GUIDE[b.curve]}")
        for n in b.notes:
            add(f"   NOTE: {n}")
    else:
        add("   NO SUITABLE BREAKER FOUND")
    add("")

    add("5. COMPLIANCE CHECKS")
    for desc, ok, detail in r.checks:
        add(f"   [{'PASS' if ok else 'FAIL'}] {desc}")
        add(f"          {detail}")
    add("")
    add(f"   OVERALL: {'COMPLIANT' if r.compliant else 'NOT COMPLIANT'}")
    add("")
    add("-" * 68)
    add("Table data is representative of Aberdare catalogue / SANS 10142-1")
    add("values. Verify against the current catalogue and standard editions")
    add("before construction. This tool assists, but does not replace, the")
    add("responsible person's design review.")
    add("-" * 68)
    return "\n".join(lines)
