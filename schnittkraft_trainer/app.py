from __future__ import annotations

import argparse
from pathlib import Path

from schnittkraft_trainer.game.console_game import run_console_game
from schnittkraft_trainer.gui.main_window import run_gui


PACKAGE_ROOT = Path(__file__).resolve().parent


def main() -> None:
    parser = argparse.ArgumentParser(description="Schnittkraft Trainer console mode")
    parser.add_argument(
        "--convention",
        default="default",
        help="Name der JSON-Datei in data/sign_conventions ohne .json",
    )
    parser.add_argument(
        "--gui",
        action="store_true",
        help="Grafische Oberfläche starten",
    )
    args = parser.parse_args()

    if args.gui:
        run_gui(PACKAGE_ROOT)
        return

    run_console_game(
        tasks_folder=PACKAGE_ROOT / "data" / "tasks",
        convention_path=(
            PACKAGE_ROOT / "data" / "sign_conventions" / f"{args.convention}.json"
        ),
    )


if __name__ == "__main__":
    main()
