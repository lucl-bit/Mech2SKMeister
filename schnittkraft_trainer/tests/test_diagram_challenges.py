import unittest

from schnittkraft_trainer.game.diagram_challenges import (
    DiagramKind,
    generate_beam_challenge,
    generate_frame_challenge,
    generate_game_challenge,
    generate_truss_challenge,
)
from schnittkraft_trainer.mechanics.sign_convention import (
    DEFAULT_CONVENTION,
    MomentPositive,
    ShearPositiveOnLeftCut,
    SignConvention,
)


class TestDiagramChallenges(unittest.TestCase):
    def test_generated_challenge_has_three_options_and_one_solution(self) -> None:
        challenge = generate_beam_challenge(DEFAULT_CONVENTION, seed=4)

        self.assertEqual(len(challenge.options), 3)
        self.assertEqual(sum(option.is_correct for option in challenge.options), 1)
        self.assertIn(challenge.diagram_kind, list(DiagramKind))

    def test_convention_changes_possible_correct_shape(self) -> None:
        default = generate_beam_challenge(DEFAULT_CONVENTION, seed=1)
        alternative = generate_beam_challenge(
            SignConvention(
                name="Alternative",
                shear_positive_on_left_cut=ShearPositiveOnLeftCut.DOWN,
                moment_positive=MomentPositive.HOGGING,
            ),
            seed=1,
        )

        default_shape = next(option.shape for option in default.options if option.is_correct)
        alternative_shape = next(
            option.shape for option in alternative.options if option.is_correct
        )

        self.assertEqual(default.diagram_kind, alternative.diagram_kind)
        if default.diagram_kind is not DiagramKind.NORMAL:
            self.assertNotEqual(default_shape, alternative_shape)

    def test_uni_cantilever_moment_is_hogging_positive(self) -> None:
        # Search across seeds for a cantilever-moment challenge: the variability
        # changes in generate_beam_challenge make any single seed brittle, but the
        # convention assertion below must hold for ALL such challenges.
        convention = SignConvention(name="Uni", moment_positive=MomentPositive.HOGGING)
        found = False
        for seed in range(200):
            challenge = generate_beam_challenge(convention, seed=seed)
            if (
                challenge.system_type == "cantilever_left"
                and challenge.diagram_kind is DiagramKind.MOMENT
            ):
                correct_shape = next(o.shape for o in challenge.options if o.is_correct)
                self.assertEqual(correct_shape, "moment_cantilever_positive")
                found = True
                break
        self.assertTrue(found, "expected at least one cantilever+moment challenge in 200 seeds")

    def test_game_challenge_progression_adds_trusses_after_ten(self) -> None:
        early = generate_game_challenge(DEFAULT_CONVENTION, challenge_number=10, seed=2)
        truss = generate_game_challenge(DEFAULT_CONVENTION, challenge_number=11, seed=2)
        frame = generate_game_challenge(DEFAULT_CONVENTION, challenge_number=21, seed=2)

        self.assertEqual(early.challenge_type, "beam")
        self.assertEqual(truss.challenge_type, "truss")
        self.assertIsNotNone(truss.truss)
        self.assertEqual(frame.challenge_type, "frame")
        self.assertIsNotNone(frame.frame)

    def test_truss_challenge_has_three_sign_options(self) -> None:
        challenge = generate_truss_challenge(DEFAULT_CONVENTION, seed=3)

        self.assertEqual(challenge.challenge_type, "truss")
        self.assertEqual(len(challenge.options), 3)
        self.assertEqual(sum(option.is_correct for option in challenge.options), 1)
        self.assertTrue(all(option.shape.startswith("truss:") for option in challenge.options))

    def test_frame_challenge_can_ask_for_n_q_or_m(self) -> None:
        kinds = {
            generate_frame_challenge(DEFAULT_CONVENTION, seed=seed).diagram_kind
            for seed in range(12)
        }

        self.assertIn(DiagramKind.NORMAL, kinds)
        self.assertIn(DiagramKind.SHEAR, kinds)
        self.assertIn(DiagramKind.MOMENT, kinds)


if __name__ == "__main__":
    unittest.main()
