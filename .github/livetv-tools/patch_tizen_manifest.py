#!/usr/bin/env python3
"""
patch_tizen_manifest.py
=======================
Nuvio LiveTV SmartTV - Tizen WGT manifest policy tool (Phase A).

Run from the repository root. Rewrites scripts/package-tizen.mjs IN PLACE so the
config.xml emitted by buildConfigXml() is valid on BOTH the Tizen 5.5 schema
(Samsung 2020: TU7000/Q90T) AND Tizen 6.0+ (2021+).

WHY
---
The retired .github/livetv-tools/inject_tizen_config.py injected a
SCHEMA-INVALID app-control block:

    <tizen:app-control>
      <tizen:src>
        <tizen:action>http://tizen.org/appcontrol/operation/search</tizen:action>
      </tizen:src>
    </tizen:app-control>

<tizen:action> is NOT a Tizen widget element and <tizen:src> REQUIRES a `name`
attribute, so Tizen Web Runtime rejects the package with:
    install failed[118, -19], reason: Parsing error

WHAT THIS TOOL DOES (idempotent; marker-guarded)
-----------------------------------------------
1. Injects a tier-aware required_version helper keyed on TIZEN_TARGET_MAJOR.
2. Rewrites the emitted required_version to use that helper.
3. Injects the CORRECT app-control block immediately after the tv.inputdevice
   privilege line of the generated manifest.
4. Hard-fails if a <tizen:action> token survives anywhere in the file.

The tool never weakens an assertion and never hand-edits the mjs at runtime: it
is the single source of truth for the manifest edit, so the cumulative patch
regenerates deterministically.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MARKER = "NUVIO_TIZEN_MANIFEST_V2"
PACKAGER = Path("scripts/package-tizen.mjs")

REQ_VER_RE = re.compile(
    r'required_version="\$\{compatibilityPolicy\.tizenInstallMinimumVersion\}"'
)
INPUTDEVICE_RE = re.compile(
    r'(?P<line>^[ \t]*<tizen:privilege name="http://tizen\.org/privilege/tv\.inputdevice"/>[ \t]*$)',
    re.MULTILINE,
)
BAD_TOKEN = "<tizen:action"

HELPER = f"""// {MARKER}: tier-aware required_version (see .github/livetv-tools/patch_tizen_manifest.py)
const NUVIO_TIZEN_TARGET_MAJOR = (() => {{
  const n = Number.parseInt(process.env.TIZEN_TARGET_MAJOR ?? "6", 10);
  return Number.isFinite(n) && n > 0 ? n : 6;
}})();
// Tizen 4.0-5.5 -> "4.0" ; Tizen 6.0+ -> "6.0"
function nuvioTizenRequiredVersion() {{
  return NUVIO_TIZEN_TARGET_MAJOR <= 5 ? "4.0" : "6.0";
}}
"""

APP_CONTROL = (
    '        <tizen:app-control>\n'
    '          <tizen:src name="index.html" reload="disable"/>\n'
    '          <tizen:operation name="http://samsung.com/appcontrol/operation/eden_resume"/>\n'
    '        </tizen:app-control>\n'
)


def main() -> int:
    if not PACKAGER.exists():
        print(f"[patch_tizen_manifest] ERROR: {PACKAGER} not found; run from repo root.", file=sys.stderr)
        return 2

    src = PACKAGER.read_text(encoding="utf-8")

    if MARKER in src:
        print("[patch_tizen_manifest] already patched (marker present); nothing to do.")
        return 0

    if BAD_TOKEN in src:
        print(
            "[patch_tizen_manifest] ERROR: found a leftover '<tizen:action' token in "
            f"{PACKAGER}.\n"
            "The retired .github/livetv-tools/inject_tizen_config.py must be deleted "
            "and removed from all workflows before re-running.",
            file=sys.stderr,
        )
        return 3

    src, n_req = REQ_VER_RE.subn('required_version="${nuvioTizenRequiredVersion()}"', src)
    if n_req != 1:
        print(
            "[patch_tizen_manifest] ERROR: expected exactly one "
            'required_version="${compatibilityPolicy.tizenInstallMinimumVersion}" occurrence, '
            f"found {n_req}. The pinned generator shape changed.",
            file=sys.stderr,
        )
        return 4

    def _inject(match: "re.Match[str]") -> str:
        return match.group("line") + "\n" + APP_CONTROL.rstrip("\n")

    src, n_inj = INPUTDEVICE_RE.subn(_inject, src, count=1)
    if n_inj != 1:
        print(
            "[patch_tizen_manifest] ERROR: could not anchor on the tv.inputdevice privilege "
            "line. The pinned generator shape changed.",
            file=sys.stderr,
        )
        return 5

    src = HELPER + "\n" + src

    PACKAGER.write_text(src, encoding="utf-8")
    print("[patch_tizen_manifest] OK: manifest policy applied (TIZEN_TARGET_MAJOR-aware).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
