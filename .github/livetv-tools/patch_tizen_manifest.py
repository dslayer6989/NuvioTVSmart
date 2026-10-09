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
A SCHEMA-INVALID app-control block can end up in the emitted manifest:

    <tizen:app-control>
      <tizen:src>
        <tizen:action>http://tizen.org/appcontrol/operation/search</tizen:action>
      </tizen:src>
    </tizen:app-control>

<tizen:action> is NOT a Tizen widget element and <tizen:src> REQUIRES a `name`
attribute, so Tizen Web Runtime rejects the package with:
    install failed[118, -19], reason: Parsing error

The retired .github/livetv-tools/inject_tizen_config.py injected this block. The
pristine upstream buildConfigXml() does NOT emit it, but the cumulative patch may
carry a stale copy, so this tool defensively REMOVES any such block from the
emitter and guarantees the ONLY app-control emitted is the schema-correct
eden_resume form.

WHAT THIS TOOL DOES (idempotent; marker-guarded)
-----------------------------------------------
1. Injects a tier-aware required_version helper keyed on TIZEN_TARGET_MAJOR.
2. Rewrites the emitted required_version to use that helper.
3. REMOVES any upstream <tizen:app-control>...</tizen:app-control> block that
   contains a <tizen:action> element (multiline, robust to whitespace).
4. Injects the CORRECT app-control block immediately after the tv.inputdevice
   privilege line of the generated manifest.
5. Hard-fails (non-zero exit) if a <tizen:action> token survives anywhere in the
   file after all transforms.

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
# Multiline match for the schema-invalid upstream app-control block. Matches the
# whole <tizen:app-control>...</tizen:app-control> element ONLY when it contains a
# <tizen:action> element, so a correct eden_resume block is never touched.
BAD_APP_CONTROL_RE = re.compile(
    r'[ \t]*<tizen:app-control\b[^>]*>'
    r'(?:(?!</tizen:app-control>)[\s\S])*?'
    r'<tizen:action\b[\s\S]*?</tizen:action>'
    r'(?:(?!</tizen:app-control>)[\s\S])*?'
    r'</tizen:app-control>[ \t]*\n?',
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

    transforms = 0

    # Transform 1: remove any schema-invalid upstream app-control block.
    src, n_strip = BAD_APP_CONTROL_RE.subn("", src)
    transforms += n_strip

    # Transform 2: rewrite required_version to the tier-aware helper.
    src, n_req = REQ_VER_RE.subn('required_version="${nuvioTizenRequiredVersion()}"', src)
    if n_req != 1:
        print(
            "[patch_tizen_manifest] ERROR: expected exactly one "
            'required_version="${compatibilityPolicy.tizenInstallMinimumVersion}" occurrence, '
            f"found {n_req}. The pinned generator shape changed.",
            file=sys.stderr,
        )
        return 4
    transforms += n_req

    # Transform 3: inject the schema-correct eden_resume app-control block.
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
    transforms += n_inj

    # Transform 4: prepend the tier-aware helper.
    src = HELPER + "\n" + src
    transforms += 1

    # Hard-fail if any schema-invalid token survives.
    if BAD_TOKEN in src:
        print(
            "[patch_tizen_manifest] ERROR: a leftover '<tizen:action' token survived all "
            f"transforms in {PACKAGER}. The retired "
            ".github/livetv-tools/inject_tizen_config.py must be deleted and removed from "
            "all workflows before re-running.",
            file=sys.stderr,
        )
        return 3

    PACKAGER.write_text(src, encoding="utf-8")
    print(
        f"[patch_tizen_manifest] OK: manifest policy applied (TIZEN_TARGET_MAJOR-aware). "
        f"Transforms applied: {transforms} "
        f"(stripped_bad_app_control={n_strip}, required_version={n_req}, "
        f"eden_resume_insert={n_inj}, helper=1)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())