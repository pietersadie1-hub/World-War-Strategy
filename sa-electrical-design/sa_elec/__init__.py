"""SA Electrical Design Verifier.

A prototype tool for South African electrical engineers to verify LV cable
sizing and protective-device selection against SANS 10142-1, using
Aberdare-style cable tables.

Modules
-------
cable_tables  : conductor data (current ratings, mV/A/m volt-drop figures)
derating      : ambient / grouping / soil / depth correction factors
calculations  : design current, motor FLC, voltage drop
mcb           : MCB / MCCB selection and grading (discrimination) checks
compliance    : end-to-end design verification + report generation
cli           : interactive command-line front end
"""

__version__ = "0.1.0"
