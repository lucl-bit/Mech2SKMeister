import unittest
from pathlib import Path

from schnittkraft_trainer.game.console_game import expected_answers, load_convention
from schnittkraft_trainer.game.tasks import load_task, save_task


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


class TestJsonStorage(unittest.TestCase):
    def test_load_example_task(self) -> None:
        task = load_task(PACKAGE_ROOT / "data" / "tasks" / "level_01_midspan_load.json")

        self.assertEqual(task.title, "Einfeldträger mit Mittellast")
        self.assertEqual(task.beam.length, 4.0)
        self.assertEqual(task.section_x, 1.0)
        self.assertEqual(len(task.beam.supports), 2)
        self.assertEqual(len(task.beam.point_loads), 1)

    def test_task_round_trip(self) -> None:
        task = load_task(PACKAGE_ROOT / "data" / "tasks" / "level_01_midspan_load.json")
        output_path = PACKAGE_ROOT / "data" / "tasks" / "_round_trip_test.json"

        try:
            save_task(task, output_path)
            loaded_task = load_task(output_path)
        finally:
            if output_path.exists():
                output_path.unlink()

        self.assertEqual(loaded_task.to_dict(), task.to_dict())

    def test_alternative_convention_changes_internal_force_signs(self) -> None:
        task = load_task(PACKAGE_ROOT / "data" / "tasks" / "level_01_midspan_load.json")
        convention = load_convention(
            PACKAGE_ROOT / "data" / "sign_conventions" / "alternative.json"
        )

        answers = expected_answers(task, convention)

        self.assertEqual(answers["Ay"], 5.0)
        self.assertEqual(answers["By"], 5.0)
        self.assertEqual(answers["Q"], -5.0)
        self.assertEqual(answers["M"], -5.0)

    def test_uni_convention_matches_table_for_midspan_load_left_cut(self) -> None:
        task = load_task(PACKAGE_ROOT / "data" / "tasks" / "level_01_midspan_load.json")
        convention = load_convention(
            PACKAGE_ROOT / "data" / "sign_conventions" / "uni.json"
        )

        answers = expected_answers(task, convention)

        self.assertEqual(answers["Ay"], 5.0)
        self.assertEqual(answers["By"], 5.0)
        self.assertEqual(answers["Q"], 5.0)
        self.assertEqual(answers["M"], -5.0)


if __name__ == "__main__":
    unittest.main()
