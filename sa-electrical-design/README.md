# SA Electrical Design Verifier (prototype)

A Python prototype that helps South African electrical engineers verify LV
designs against **SANS 10142-1**, using **Aberdare-style cable tables**
("ABEDERE" in the original brief — the Aberdare Cables catalogue).

It automates the workflow discussed:

1. **Project parameters** — voltage (230 V / 400 V / …), current type
   (DC, single-phase, three-phase), load type (motor, lighting, heating,
   general), route length.
2. **Cable calculation** — design current Ib (with pf and motor efficiency),
   candidate cable from the Aberdare-style tables, installation method
   (air / conduit / buried direct).
3. **Derating** — ambient air temperature, ground temperature, grouping,
   soil thermal resistivity, burial depth. Interpolates between tabulated
   points and refuses to extrapolate beyond them.
4. **Protection** — smallest MCB/MCCB with **Ib ≤ In ≤ Iz**, trip-curve
   recommendation (B/C/D, with motor-starting inrush check), breaking
   capacity vs prospective fault level, and **grading** (discrimination)
   checks along a breaker chain.
5. **Compliance** — volt drop ≤ 5 % (SANS 10142-1), coordination check,
   earth-conductor size (table method), and a printable verification report.

## Requirements

Python 3.9+ only — no third-party dependencies.

## Usage

```bash
cd sa-electrical-design

# Guided wizard (asks questions, prints a compliance report)
python -m sa_elec

# One-shot sizing: 15 kW DOL motor, 400 V, 120 m buried run,
# grouped with 1 other circuit, warm wet-season soil
python -m sa_elec size --name "Pump 1" --supply 3ph --voltage 400 \
    --kw 15 --pf 0.85 --eff 0.9 --load-type motor --start dol \
    --length 120 --install buried --ground-temp 30 --grouped 2 \
    --soil 1.5 --depth 0.8 --fault-ka 6

# Grading check of a distribution chain (supply side first)
python -m sa_elec grade 250 100 63 20
```

Exit code is `0` when the design is compliant, `1` when not — handy for
batch verification scripts.

## Package layout

```
sa_elec/
  cable_tables.py   Aberdare-style Cu/Al PVC SWA tables (ratings + mV/A/m)
  derating.py       SANS/IEC correction factors and combination logic
  calculations.py   Ib, motor FLC & starting current, voltage drop
  mcb.py            MCB/MCCB selection, curve choice, grading checks
  compliance.py     end-to-end verification + report rendering
  cli.py            wizard + argparse front end
tests/              unit + end-to-end tests (python -m unittest)
```

## Running the tests

```bash
cd sa-electrical-design
python -m unittest discover -s tests -v
```

## Extending it

- **Real catalogue data**: replace the representative figures in
  `cable_tables.py` with the exact values from your Aberdare catalogue
  edition (XLPE families, single-core, larger sizes, ducts, etc.). The
  rest of the tool picks them up automatically.
- **More checks**: earth-fault loop impedance / disconnection times,
  adiabatic short-circuit check (k·S ≥ I√t), motor-starting volt drop.
- **UI**: the modules are UI-agnostic — a Flask/FastAPI web front end or
  a spreadsheet exporter can call `verify_circuit()` directly.

## Important disclaimer

The bundled table values are **representative** of Aberdare catalogue /
SANS 10142-1 figures and are provided so the workflow can be developed and
tested. **Verify every figure against the current Aberdare catalogue and
the SANS 10142-1 edition in force before using any output for a real
installation.** This tool assists, but does not replace, design review and
sign-off by the responsible registered person.
