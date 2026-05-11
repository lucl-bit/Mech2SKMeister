from __future__ import annotations

import tkinter as tk
from pathlib import Path
from tkinter import ttk

from schnittkraft_trainer.gui.diagram_game import DiagramGameFrame
from schnittkraft_trainer.gui.theme import Theme
from schnittkraft_trainer.gui.truss_builder import TrussBuilderFrame


class MainWindow(tk.Tk):
    """Application shell with a start menu and swappable screens."""

    def __init__(self, package_root: Path) -> None:
        super().__init__()
        self.package_root = package_root
        self.current_frame: ttk.Frame | None = None

        self.title("Schnittkraft Trainer")
        self.geometry("1180x820")
        self.minsize(980, 700)
        self.configure(bg=Theme.BG)

        self._configure_styles()
        self.show_menu()

    def _configure_styles(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TFrame", background=Theme.BG)
        style.configure("TopBar.TFrame", background=Theme.SURFACE)
        style.configure("Card.TFrame", background=Theme.SURFACE, relief="flat")
        style.configure(
            "Title.TLabel",
            background=Theme.SURFACE,
            foreground=Theme.TEXT,
            font=(Theme.FONT_FAMILY, 23, "bold"),
        )
        style.configure(
            "Hero.TLabel",
            background=Theme.BG,
            foreground=Theme.TEXT,
            font=(Theme.FONT_FAMILY, 32, "bold"),
        )
        style.configure(
            "HeroSub.TLabel",
            background=Theme.BG,
            foreground=Theme.MUTED,
            font=(Theme.FONT_FAMILY, 13),
        )
        style.configure(
            "CardTitle.TLabel",
            background=Theme.SURFACE,
            foreground=Theme.TEXT,
            font=(Theme.FONT_FAMILY, 17, "bold"),
        )
        style.configure(
            "CardText.TLabel",
            background=Theme.SURFACE,
            foreground=Theme.MUTED,
            font=(Theme.FONT_FAMILY, 12),
        )
        style.configure(
            "Muted.TLabel",
            background=Theme.SURFACE,
            foreground=Theme.MUTED,
            font=(Theme.FONT_FAMILY, 11),
        )
        style.configure(
            "Status.TLabel",
            background=Theme.SURFACE,
            foreground=Theme.TEXT,
            font=(Theme.FONT_FAMILY, 13, "bold"),
        )
        style.configure(
            "Accent.TButton",
            background=Theme.BLUE,
            foreground="#FFFFFF",
            font=(Theme.FONT_FAMILY, 12, "bold"),
            padding=(14, 10),
        )
        style.configure("TButton", padding=(12, 9), font=(Theme.FONT_FAMILY, 11))
        style.configure("TCombobox", padding=(8, 8), font=(Theme.FONT_FAMILY, 11))

    def show_menu(self) -> None:
        self._replace_frame(StartMenuFrame(self, self.show_diagram_game, self.show_truss_builder))

    def show_diagram_game(self) -> None:
        self._replace_frame(DiagramGameFrame(self, self.package_root, self.show_menu))

    def show_truss_builder(self) -> None:
        self._replace_frame(TrussBuilderFrame(self, self.show_menu))

    def _replace_frame(self, frame: ttk.Frame) -> None:
        if self.current_frame is not None:
            self.current_frame.destroy()
        self.current_frame = frame
        self.current_frame.pack(fill=tk.BOTH, expand=True)


class StartMenuFrame(ttk.Frame):
    def __init__(
        self,
        master: tk.Misc,
        on_diagram_game: callable[[], None],
        on_truss_builder: callable[[], None],
    ) -> None:
        super().__init__(master, style="TFrame", padding=34)
        self.on_diagram_game = on_diagram_game
        self.on_truss_builder = on_truss_builder
        self._build_layout()

    def _build_layout(self) -> None:
        header = ttk.Frame(self, style="TFrame")
        header.pack(fill=tk.X, pady=(10, 34))
        ttk.Label(header, text="Schnittkraft Trainer", style="Hero.TLabel").pack(anchor="w")
        ttk.Label(
            header,
            text="Wähle, ob du Verläufe trainieren oder ein eigenes Fachwerk aufbauen möchtest.",
            style="HeroSub.TLabel",
        ).pack(anchor="w", pady=(8, 0))

        cards = ttk.Frame(self, style="TFrame")
        cards.pack(fill=tk.BOTH, expand=True)
        cards.columnconfigure(0, weight=1)
        cards.columnconfigure(1, weight=1)

        self._menu_card(
            cards,
            column=0,
            title="Verlauf-Spiel",
            text="Zufällige Balkenaufgaben. Wähle den richtigen N-, Q- oder M-Verlauf nach deiner Uni-Konvention.",
            button_text="Spiel starten",
            command=self.on_diagram_game,
            accent=Theme.PURPLE,
        )
        self._menu_card(
            cards,
            column=1,
            title="Fachwerk bauen",
            text="Knoten setzen, Stäbe verbinden, Festlager/Loslager und Knotenlasten hinzufügen. Der Stabkraft-Solver folgt als nächster Schritt.",
            button_text="Builder öffnen",
            command=self.on_truss_builder,
            accent=Theme.GREEN,
        )

    def _menu_card(
        self,
        parent: ttk.Frame,
        column: int,
        title: str,
        text: str,
        button_text: str,
        command: callable[[], None],
        accent: str,
    ) -> None:
        card = ttk.Frame(parent, style="Card.TFrame", padding=26)
        card.grid(row=0, column=column, sticky="nsew", padx=12)
        marker = tk.Canvas(card, width=52, height=8, bg=Theme.SURFACE, highlightthickness=0)
        marker.create_rectangle(0, 0, 52, 8, fill=accent, outline=accent)
        marker.pack(anchor="w", pady=(0, 22))
        ttk.Label(card, text=title, style="CardTitle.TLabel").pack(anchor="w")
        ttk.Label(
            card,
            text=text,
            style="CardText.TLabel",
            wraplength=390,
            justify=tk.LEFT,
        ).pack(anchor="w", pady=(10, 24))
        ttk.Button(card, text=button_text, command=command, style="Accent.TButton").pack(
            anchor="w"
        )


def run_gui(package_root: Path) -> None:
    window = MainWindow(package_root)
    window.mainloop()
