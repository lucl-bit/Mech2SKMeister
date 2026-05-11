from __future__ import annotations

import json
import tkinter as tk
from pathlib import Path
from tkinter import ttk

from schnittkraft_trainer.game.console_game import load_convention
from schnittkraft_trainer.game.diagram_challenges import (
    DiagramChallenge,
    generate_game_challenge,
)
from schnittkraft_trainer.gui.canvas import ChallengeCanvas
from schnittkraft_trainer.gui.theme import Theme
from schnittkraft_trainer.mechanics.sign_convention import SignConvention


class DiagramGameFrame(ttk.Frame):
    """Multiple-choice diagram game screen."""

    def __init__(self, master: tk.Misc, package_root: Path, on_back: callable[[], None]) -> None:
        super().__init__(master, style="TFrame")
        self.package_root = package_root
        self.on_back = on_back
        self.conventions = self._load_conventions(package_root / "data" / "sign_conventions")
        self.current_convention = self._preferred_convention()
        self.challenge_count = 0
        self.attempts = 0
        self.score = 0
        self.current_challenge: DiagramChallenge | None = None

        self._build_layout()
        self._new_challenge()

    def _build_layout(self) -> None:
        top = ttk.Frame(self, style="TopBar.TFrame", padding=(22, 16))
        top.pack(fill=tk.X)

        left = ttk.Frame(top, style="TopBar.TFrame")
        left.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(left, text="Menü", command=self.on_back).pack(side=tk.LEFT, padx=(0, 14))
        title_box = ttk.Frame(left, style="TopBar.TFrame")
        title_box.pack(side=tk.LEFT)
        ttk.Label(title_box, text="Verlauf-Spiel", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            title_box,
            text=(
                "Erkenne den richtigen Verlauf. Koordinaten: x nach rechts, y nach unten; "
                "Schnittgrössen nach aktiver Konvention."
            ),
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(3, 0))

        right = ttk.Frame(top, style="TopBar.TFrame")
        right.pack(side=tk.RIGHT)
        ttk.Label(right, text="Aktive Konvention", style="Muted.TLabel").pack(anchor="e")
        self.convention_var = tk.StringVar(value=self.current_convention.name)
        self.convention_combo = ttk.Combobox(
            right,
            textvariable=self.convention_var,
            values=[convention.name for convention in self.conventions],
            state="readonly",
            width=48,
        )
        self.convention_combo.pack(anchor="e", pady=(4, 0))
        self.convention_combo.bind("<<ComboboxSelected>>", self._on_convention_changed)

        status = ttk.Frame(self, style="TopBar.TFrame", padding=(22, 0, 22, 14))
        status.pack(fill=tk.X)
        self.status_label = ttk.Label(status, text="", style="Status.TLabel")
        self.status_label.pack(side=tk.LEFT)
        self.feedback_label = ttk.Label(status, text="", style="Muted.TLabel")
        self.feedback_label.pack(side=tk.RIGHT)

        self.canvas = ChallengeCanvas(self)
        self.canvas.pack(fill=tk.BOTH, expand=True, padx=22, pady=(18, 22))
        self.canvas.on_option_selected = self._check_option

        bottom = ttk.Frame(self, padding=(22, 0, 22, 18))
        bottom.pack(fill=tk.X)
        ttk.Button(
            bottom,
            text="Neue Aufgabe",
            command=self._new_challenge,
            style="Accent.TButton",
        ).pack(side=tk.RIGHT)

    def _load_conventions(self, folder: Path) -> list[SignConvention]:
        conventions = [load_convention(path) for path in sorted(folder.glob("*.json"))]
        if not conventions:
            raise ValueError("No sign conventions found.")
        return conventions

    def _preferred_convention(self) -> SignConvention:
        for convention in self.conventions:
            if convention.name.startswith("Uni:"):
                return convention
        return self.conventions[0]

    def _new_challenge(self) -> None:
        self.challenge_count += 1
        self.current_challenge = generate_game_challenge(
            self.current_convention,
            challenge_number=self.challenge_count,
        )
        self.canvas.set_challenge(self.current_challenge)
        self.feedback_label.configure(
            text="Klicke den Verlauf an, der zur Aufgabe passt.",
            foreground=Theme.MUTED,
        )
        self._update_status()

    def _check_option(self, option_id: str) -> None:
        if self.current_challenge is None:
            return

        self.canvas.mark_selection(option_id, checked=True)
        self.attempts += 1

        if option_id == self.current_challenge.correct_option_id:
            self.score += 1
            self.feedback_label.configure(
                text=f"Richtig. {self.current_challenge.explanation}",
                foreground=Theme.GREEN,
            )
            self._save_progress(was_correct=True)
            self.after(1500, self._new_challenge)
        else:
            self.feedback_label.configure(
                text=f"Falsch. {self.current_challenge.explanation}",
                foreground=Theme.ORANGE,
            )
            self._save_progress(was_correct=False)

        self._update_status()

    def _update_status(self) -> None:
        self.status_label.configure(
            text=f"Aufgabe {self.challenge_count}    Punkte {self.score}/{self.attempts}"
        )

    def _on_convention_changed(self, _event: tk.Event) -> None:
        selected_name = self.convention_var.get()
        self.current_convention = next(
            convention for convention in self.conventions if convention.name == selected_name
        )
        self.feedback_label.configure(
            text=f"Konvention geändert: {self.current_convention.name}",
            foreground=Theme.BLUE,
        )
        self._new_challenge()

    def _save_progress(self, was_correct: bool) -> None:
        path = self.package_root / "data" / "progress" / "gui_progress.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "mode": "diagram_choice",
            "score": self.score,
            "attempts": self.attempts,
            "last_answer_correct": was_correct,
            "active_convention": self.current_convention.name,
        }
        with path.open("w", encoding="utf-8") as file:
            json.dump(data, file, indent=2)
            file.write("\n")
