from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AnswerCheck:
    name: str
    expected: float
    actual: float
    tolerance: float

    @property
    def is_correct(self) -> bool:
        return abs(self.expected - self.actual) <= self.tolerance

    @property
    def has_correct_amount_wrong_sign(self) -> bool:
        return (
            abs(abs(self.expected) - abs(self.actual)) <= self.tolerance
            and not self.is_correct
        )


@dataclass(frozen=True)
class ScoreResult:
    checks: list[AnswerCheck]
    earned_points: int
    max_points: int

    @property
    def is_perfect(self) -> bool:
        return all(check.is_correct for check in self.checks)


def check_answers(
    expected: dict[str, float],
    actual: dict[str, float],
    max_points: int,
    tolerance: float = 0.01,
) -> ScoreResult:
    checks = [
        AnswerCheck(
            name=name,
            expected=expected[name],
            actual=actual[name],
            tolerance=tolerance,
        )
        for name in expected
    ]

    correct_count = sum(1 for check in checks if check.is_correct)
    earned_points = round(max_points * correct_count / len(checks))

    return ScoreResult(
        checks=checks,
        earned_points=earned_points,
        max_points=max_points,
    )
