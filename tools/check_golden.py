"""Prueft, ob tests_static/golden.json noch zu den Python-Loesern passt.

Rechnet jeden Fall neu und vergleicht mit Toleranz statt bit-exakt: numpy
nutzt je Plattform ein anderes BLAS (Apple Accelerate auf macOS, OpenBLAS auf
den Linux-Runnern), weshalb np.linalg.solve in der letzten Stelle abweichen
darf. Ein echter Fehler - geaenderter Loeser, nicht neu gebaute Golden-Datei -
liegt um Groessenordnungen darueber.

Aufruf:  python3 tools/check_golden.py [--tol 1e-9]
Exit 1, wenn ein Fall abweicht.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tools.build_static import solve_with_python  # noqa: E402


def compare(actual: float, expected: float, tol: float) -> bool:
    return abs(actual - expected) / max(1.0, abs(expected)) <= tol


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tol", type=float, default=1e-9, help="relative Toleranz (Default 1e-9)")
    args = parser.parse_args()

    golden = json.loads((ROOT / "tests_static" / "golden.json").read_text(encoding="utf-8"))
    problems: list[str] = []
    worst = 0.0

    for case in golden["cases"]:
        result = solve_with_python(case["kind"], case["payload"])
        if result is None:
            problems.append(f"{case['name']}: nicht mehr loesbar")
            continue

        expected = case["expected"]
        for group in ("bar_forces", "reactions"):
            if set(result[group]) != set(expected[group]):
                problems.append(f"{case['name']}.{group}: andere Schluessel")
                continue
            for key, exp_value in expected[group].items():
                got = result[group][key]
                pairs = got.items() if isinstance(exp_value, dict) else [(None, got)]
                for sub, got_value in pairs:
                    ref = exp_value[sub] if sub is not None else exp_value
                    worst = max(worst, abs(got_value - ref) / max(1.0, abs(ref)))
                    if not compare(got_value, ref, args.tol):
                        label = f"{key}.{sub}" if sub else key
                        problems.append(
                            f"{case['name']}.{group}.{label}: {got_value} statt {ref}"
                        )

    if problems:
        print(f"golden.json passt NICHT zu den Loesern ({len(problems)} Abweichungen):")
        for problem in problems[:15]:
            print(f"  {problem}")
        print("Bitte 'python3 tools/build_static.py' laufen lassen und committen.")
        return 1

    print(f"golden.json passt zu den Loesern: {len(golden['cases'])} Faelle, "
          f"groesste relative Abweichung {worst:.2e} (Toleranz {args.tol:.0e})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
