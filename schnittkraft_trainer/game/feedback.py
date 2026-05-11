from __future__ import annotations

from schnittkraft_trainer.game.scoring import ScoreResult


def build_feedback(result: ScoreResult) -> list[str]:
    """Create useful feedback without revealing a full solution immediately."""

    if result.is_perfect:
        return ["Alles richtig. Sauber gerechnet."]

    messages: list[str] = []
    for check in result.checks:
        if check.is_correct:
            messages.append(f"{check.name}: richtig.")
        elif check.has_correct_amount_wrong_sign:
            messages.append(
                f"{check.name}: Betrag stimmt, aber das Vorzeichen ist falsch."
            )
        else:
            messages.append(
                f"{check.name}: noch nicht richtig. Prüfe Gleichgewicht und Einheiten."
            )

    return messages
