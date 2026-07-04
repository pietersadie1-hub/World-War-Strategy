"""Command-line interface.

Usage examples
--------------
# Guided wizard
python -m sa_elec

# Direct circuit verification
python -m sa_elec size --name "Pump 1" --supply 3ph --voltage 400 \
    --kw 15 --pf 0.85 --eff 0.9 --load-type motor --start dol \
    --length 120 --install buried --ground-temp 30 --grouped 2 \
    --soil 1.5 --depth 0.8 --fault-ka 6

# Grading check of a breaker chain (supply side first)
python -m sa_elec grade 250 100 63 20
"""

import argparse
import sys

from . import cable_tables, mcb
from .calculations import Load
from .compliance import CircuitDesign, render_report, verify_circuit
from .derating import DeratingInput


# ---------------------------------------------------------------------------
# argparse front end
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="sa_elec",
        description="SA electrical design verifier (SANS 10142-1 / "
                    "Aberdare-style cable tables). Run with no arguments "
                    "for the interactive wizard.")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("size", help="Size a cable and breaker for one circuit")
    s.add_argument("--name", default="Circuit 1")
    s.add_argument("--supply", choices=("dc", "1ph", "3ph"), default="3ph")
    s.add_argument("--voltage", type=float, default=400.0)
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--kw", type=float, help="Load power in kW")
    g.add_argument("--amps", type=float, help="Load current in A")
    s.add_argument("--pf", type=float, default=0.9, help="Power factor")
    s.add_argument("--eff", type=float, default=1.0, help="Motor efficiency")
    s.add_argument("--load-type", choices=("general", "motor", "lighting", "heating"),
                   default="general")
    s.add_argument("--start", choices=("dol", "star-delta", "soft", "vsd"),
                   help="Motor starting method")
    s.add_argument("--length", type=float, required=True, help="Route length (m)")
    s.add_argument("--family", choices=sorted(cable_tables.CABLE_FAMILIES),
                   default="cu_pvc_swa")
    s.add_argument("--install", choices=("air", "conduit", "buried"), default="air")
    s.add_argument("--ambient", type=float, default=30.0, help="Ambient air degC")
    s.add_argument("--ground-temp", type=float, default=25.0, help="Ground degC")
    s.add_argument("--grouped", type=int, default=1, help="Number of grouped circuits")
    s.add_argument("--soil", type=float, default=1.2,
                   help="Soil thermal resistivity (K.m/W)")
    s.add_argument("--depth", type=float, default=0.5, help="Burial depth (m)")
    s.add_argument("--fault-ka", type=float, default=5.0,
                   help="Prospective fault level (kA)")
    s.add_argument("--vd-limit", type=float, default=5.0,
                   help="Volt-drop limit (%%)")

    gr = sub.add_parser("grade", help="Check discrimination along a breaker chain")
    gr.add_argument("ratings", type=int, nargs="+",
                    help="Breaker ratings in A, supply side first, e.g. 250 100 63 20")

    return p


def run_size(args) -> int:
    load = Load(supply=args.supply, voltage_v=args.voltage,
                power_kw=args.kw, current_a=args.amps,
                power_factor=args.pf, efficiency=args.eff,
                load_type=args.load_type)
    circuit = CircuitDesign(
        name=args.name, load=load, length_m=args.length,
        cable_family=args.family,
        derating=DeratingInput(
            installation=args.install, ambient_air_c=args.ambient,
            ground_temp_c=args.ground_temp, grouped_circuits=args.grouped,
            soil_resistivity_kmw=args.soil, burial_depth_m=args.depth),
        fault_level_ka=args.fault_ka,
        starting_method=args.start,
        vd_limit_percent=args.vd_limit)
    result = verify_circuit(circuit)
    print(render_report(result))
    return 0 if result.compliant else 1


def run_grade(args) -> int:
    steps = mcb.check_grading(args.ratings)
    if not steps:
        print("Need at least two ratings to grade.")
        return 2
    print("GRADING / DISCRIMINATION CHECK (current-based rule of thumb)")
    print("-" * 60)
    all_ok = True
    for st in steps:
        flag = "PASS" if st.ok else "FAIL"
        print(f" [{flag}] {st.upstream_a} A -> {st.downstream_a} A "
              f"(ratio {st.ratio:.2f}:1)")
        print(f"        {st.comment}")
        if not st.ok:
            suggestion = mcb.suggest_upstream(st.downstream_a)
            if suggestion and suggestion != st.upstream_a:
                print(f"        Suggested minimum upstream rating: {suggestion} A")
            all_ok = False
    print("-" * 60)
    print(f"OVERALL: {'GRADED' if all_ok else 'NOT GRADED'} "
          "(verify with manufacturer curves for final design)")
    return 0 if all_ok else 1


# ---------------------------------------------------------------------------
# Interactive wizard
# ---------------------------------------------------------------------------
def _ask(prompt: str, default, cast=str, choices=None):
    while True:
        suffix = f" [{default}]" if default is not None else ""
        raw = input(f"  {prompt}{suffix}: ").strip()
        if not raw:
            if default is None:
                print("    A value is required.")
                continue
            return default
        try:
            val = cast(raw)
        except ValueError:
            print(f"    Could not interpret {raw!r}.")
            continue
        if choices and val not in choices:
            print(f"    Choose one of: {', '.join(map(str, choices))}")
            continue
        return val


def wizard() -> int:
    print("SA ELECTRICAL DESIGN VERIFIER - interactive wizard")
    print("(press Enter to accept the [default] value)\n")

    print("1. Project parameters")
    supply = _ask("Supply (dc / 1ph / 3ph)", "3ph", str, ("dc", "1ph", "3ph"))
    default_v = {"dc": 220.0, "1ph": 230.0, "3ph": 400.0}[supply]
    voltage = _ask("Nominal voltage (V)", default_v, float)
    load_type = _ask("Load type (general / motor / lighting / heating)",
                     "general", str, ("general", "motor", "lighting", "heating"))
    kw = _ask("Load power (kW)", None, float)
    pf = 1.0 if supply == "dc" else _ask("Power factor", 0.9, float)
    eff, start = 1.0, None
    if load_type == "motor":
        eff = _ask("Motor efficiency (0-1)", 0.9, float)
        start = _ask("Starting method (dol / star-delta / soft / vsd)",
                     "dol", str, ("dol", "star-delta", "soft", "vsd"))
    length = _ask("Route length (m)", None, float)

    print("\n2. Cable and installation")
    family = _ask("Cable family (cu_pvc_swa / al_pvc_swa)", "cu_pvc_swa",
                  str, tuple(cable_tables.CABLE_FAMILIES))
    install = _ask("Installation (air / conduit / buried)", "air",
                   str, ("air", "conduit", "buried"))
    grouped = _ask("Number of grouped circuits", 1, int)
    if install == "buried":
        gtemp = _ask("Ground temperature (degC)", 25.0, float)
        soil = _ask("Soil thermal resistivity (K.m/W)", 1.2, float)
        depth = _ask("Burial depth (m)", 0.5, float)
        ambient = 30.0
    else:
        ambient = _ask("Ambient air temperature (degC)", 30.0, float)
        gtemp, soil, depth = 25.0, 1.2, 0.5

    print("\n3. Protection")
    fault = _ask("Prospective fault level (kA)", 5.0, float)

    load = Load(supply=supply, voltage_v=voltage, power_kw=kw,
                power_factor=pf, efficiency=eff, load_type=load_type)
    circuit = CircuitDesign(
        name=_ask("Circuit name", "Circuit 1"),
        load=load, length_m=length, cable_family=family,
        derating=DeratingInput(installation=install, ambient_air_c=ambient,
                               ground_temp_c=gtemp, grouped_circuits=grouped,
                               soil_resistivity_kmw=soil, burial_depth_m=depth),
        fault_level_ka=fault, starting_method=start)

    print()
    result = verify_circuit(circuit)
    print(render_report(result))

    if result.breaker and _ask("\nCheck grading against an upstream chain? (y/n)",
                               "n", str, ("y", "n")) == "y":
        raw = _ask("Upstream ratings, supply side first (e.g. 250 100)", None, str)
        chain = [int(x) for x in raw.split()] + [result.breaker.rating_a]
        class _Args:  # reuse the grade printer
            ratings = chain
        run_grade(_Args)
    return 0 if result.compliant else 1


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "size":
            return run_size(args)
        if args.command == "grade":
            return run_grade(args)
        return wizard()
    except (ValueError, KeyboardInterrupt) as exc:
        if isinstance(exc, KeyboardInterrupt):
            print("\nAborted.")
            return 130
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
