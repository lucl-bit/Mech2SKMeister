from __future__ import annotations

import math
import tkinter as tk
from dataclasses import dataclass
from tkinter import ttk

from schnittkraft_trainer.gui.theme import Theme
from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)


@dataclass
class TrussNode:
    node_id: int
    x: float
    y: float


@dataclass
class TrussMember:
    start_id: int
    end_id: int


@dataclass
class TrussLoad:
    node_id: int
    fx: float = 0.0
    fy: float = 10.0


@dataclass
class BeamMemberResult:
    member_index: int
    fixed_node_id: int
    free_node_id: int
    normal_force: float
    shear_force: float
    fixed_moment: float


class TrussBuilderFrame(ttk.Frame):
    """First interactive truss builder screen.

    This is not the solver yet. It creates the drawing/editing mode we need
    before member-force calculation is added.
    """

    def __init__(self, master: tk.Misc, on_back: callable[[], None]) -> None:
        super().__init__(master, style="TFrame")
        self.tool = tk.StringVar(value="node")
        self.response_mode = tk.StringVar(value="N")
        self.status = tk.StringVar(value="Werkzeug wählen und im Raster klicken.")
        self._build_layout(on_back)

    def _build_layout(self, on_back: callable[[], None]) -> None:
        top = ttk.Frame(self, style="TopBar.TFrame", padding=(22, 16))
        top.pack(fill=tk.X)
        ttk.Button(top, text="Menü", command=on_back).pack(side=tk.LEFT, padx=(0, 14))
        title_box = ttk.Frame(top, style="TopBar.TFrame")
        title_box.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Label(title_box, text="Fachwerk bauen", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            title_box,
            text="Knoten setzen, Stäbe verbinden, Lager und Lasten ergänzen.",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(3, 0))

        content = ttk.Frame(self, padding=22)
        content.pack(fill=tk.BOTH, expand=True)
        content.columnconfigure(1, weight=1)
        content.rowconfigure(0, weight=1)

        tools = ttk.Frame(content, style="Card.TFrame", padding=Theme.CARD_PAD)
        tools.grid(row=0, column=0, sticky="ns", padx=(0, 16))
        ttk.Label(tools, text="Werkzeuge", style="CardTitle.TLabel").pack(anchor="w")

        tool_items = [
            ("node", "Knoten"),
            ("member", "Stab"),
            ("pin", "Festlager"),
            ("roller", "Loslager"),
            ("fixed", "Einspannung"),
            ("free", "Freies Ende"),
            ("load", "Last ziehen"),
            ("delete", "Löschen"),
        ]
        for value, label in tool_items:
            ttk.Radiobutton(
                tools,
                text=label,
                value=value,
                variable=self.tool,
                command=self._tool_changed,
            ).pack(anchor="w", pady=(12, 0))

        ttk.Separator(tools).pack(fill=tk.X, pady=18)
        ttk.Button(tools, text="Beispiel-Fachwerk", command=self._load_example).pack(fill=tk.X)
        ttk.Button(tools, text="Leeren", command=self._clear).pack(fill=tk.X, pady=(8, 0))
        ttk.Button(tools, text="System prüfen", command=self._validate).pack(fill=tk.X, pady=(8, 0))
        ttk.Button(tools, text="Berechnen", command=self._solve).pack(fill=tk.X, pady=(8, 0))

        ttk.Separator(tools).pack(fill=tk.X, pady=18)
        ttk.Label(tools, text="Beanspruchung", style="CardTitle.TLabel").pack(anchor="w")
        modes = [("M", Theme.RED), ("Q", Theme.PURPLE), ("N", Theme.GREEN)]
        for mode, color in modes:
            button = tk.Radiobutton(
                tools,
                text=mode,
                value=mode,
                variable=self.response_mode,
                command=self._response_mode_changed,
                indicatoron=False,
                width=4,
                font=(Theme.FONT_FAMILY, 18, "bold"),
                fg=color,
                bg=Theme.SURFACE,
                selectcolor="#FFF6D8",
                activebackground=Theme.SURFACE_ALT,
                relief=tk.RAISED,
                bd=2,
            )
            button.pack(side=tk.LEFT, padx=(0, 8), pady=(10, 0))

        center = ttk.Frame(content)
        center.grid(row=0, column=1, sticky="nsew")
        center.rowconfigure(0, weight=1)
        center.columnconfigure(0, weight=1)
        self.canvas = TrussCanvas(center, self.tool, self.response_mode, self.status)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        bottom = ttk.Frame(self, style="TopBar.TFrame", padding=(22, 0, 22, 18))
        bottom.pack(fill=tk.X)
        ttk.Label(bottom, textvariable=self.status, style="Status.TLabel").pack(side=tk.LEFT)

    def _tool_changed(self) -> None:
        self.canvas.active_member_start = None
        self.status.set("Werkzeug aktiv: " + self.tool.get())

    def _load_example(self) -> None:
        self.canvas.load_example()

    def _clear(self) -> None:
        self.canvas.clear()

    def _validate(self) -> None:
        self.canvas.validate_structure()

    def _solve(self) -> None:
        self.canvas.solve_structure()

    def _response_mode_changed(self) -> None:
        self.canvas.redraw()
        mode = self.response_mode.get()
        if mode == "N":
            self.status.set("N-Modus: Normalkraft anzeigen. Positive N = Zug.")
        else:
            self.status.set(f"{mode}-Modus: Beanspruchungsverlauf anzeigen.")


class TrussCanvas(tk.Canvas):
    def __init__(
        self,
        master: tk.Misc,
        tool: tk.StringVar,
        response_mode: tk.StringVar,
        status: tk.StringVar,
        **kwargs: object,
    ) -> None:
        super().__init__(master, bg=Theme.PAPER, highlightthickness=0, **kwargs)
        self.tool = tool
        self.response_mode = response_mode
        self.status = status
        self.nodes: list[TrussNode] = []
        self.members: list[TrussMember] = []
        self.supports: dict[int, str] = {}
        self.free_ends: set[int] = set()
        self.loads: dict[int, TrussLoad] = {}
        self.member_forces: dict[int, float] = {}
        self.beam_results: dict[int, BeamMemberResult] = {}
        self.reactions: dict[str, float] = {}
        self.next_node_id = 1
        self.active_member_start: int | None = None
        self.active_load_node_id: int | None = None
        self.preview_load_end: tuple[float, float] | None = None
        self.snap = 24
        self.bind("<Configure>", lambda _event: self.redraw())
        self.bind("<ButtonPress-1>", self._handle_press)
        self.bind("<B1-Motion>", self._handle_drag)
        self.bind("<ButtonRelease-1>", self._handle_release)

    def clear(self) -> None:
        self.nodes = []
        self.members = []
        self.supports = {}
        self.free_ends = set()
        self.loads = {}
        self.member_forces = {}
        self.beam_results = {}
        self.reactions = {}
        self.next_node_id = 1
        self.active_member_start = None
        self.active_load_node_id = None
        self.preview_load_end = None
        self.status.set("Leere Zeichenfläche.")
        self.redraw()

    def load_example(self) -> None:
        self.clear()
        width = max(self.winfo_width(), 760)
        height = max(self.winfo_height(), 520)
        base_y = self._snap(height * 0.62)
        left = self._snap(width * 0.27)
        mid = self._snap(width * 0.5)
        right = self._snap(width * 0.73)
        top_y = self._snap(height * 0.35)

        for x, y in [(left, base_y), (mid, top_y), (right, base_y)]:
            self._add_node(x, y)
        self.members = [TrussMember(1, 2), TrussMember(2, 3), TrussMember(1, 3)]
        self.supports = {1: "pin", 3: "roller"}
        self.loads = {2: TrussLoad(node_id=2, fy=10.0)}
        self.status.set("Beispiel geladen. Klicke Berechnen für Stabkräfte.")
        self.redraw()

    def validate_structure(self) -> None:
        joint_count = len(self.nodes)
        member_count = len(self.members)
        if self._cantilever_case() is not None:
            self.status.set("Kragträger erkannt: Einspannung + freies Ende. Berechnen ist möglich.")
            return

        reaction_count = sum(
            2 if value in {"pin", "fixed"} else 1
            for value in self.supports.values()
        )
        left_side = member_count + reaction_count
        right_side = 2 * joint_count

        if joint_count < 2:
            self.status.set("Noch zu wenige Knoten.")
        elif member_count == 0:
            self.status.set("Noch keine Stäbe gesetzt.")
        elif reaction_count < 3:
            self.status.set("Noch nicht ausreichend gelagert.")
        elif left_side == right_side:
            self.status.set("Zählkriterium erfüllt: m + r = 2j. Solver folgt als nächstes.")
        elif left_side < right_side:
            self.status.set("System wirkt unterbestimmt: zu wenige Stäbe oder Lager.")
        else:
            self.status.set("System wirkt überbestimmt: zu viele Stäbe oder Lager.")

    def solve_structure(self) -> None:
        cantilever = self._cantilever_case()
        if cantilever is not None:
            self._solve_cantilever(cantilever)
            return

        try:
            result = solve_truss(self._to_solver_model())
        except ValueError as error:
            self.member_forces = {}
            self.beam_results = {}
            self.reactions = {}
            self.status.set(f"Nicht lösbar: {error}")
            self.redraw()
            return

        self.member_forces = result.bar_forces
        self.beam_results = {}
        self.reactions = result.reactions
        tension_count = sum(1 for value in self.member_forces.values() if value > 1e-6)
        compression_count = sum(1 for value in self.member_forces.values() if value < -1e-6)
        self.status.set(
            f"Berechnet: {tension_count} Zugstäbe, {compression_count} Druckstäbe. "
            "Wähle N, Q oder M für die Anzeige."
        )
        self.redraw()

    def redraw(self) -> None:
        self.delete("all")
        width = max(self.winfo_width(), 760)
        height = max(self.winfo_height(), 520)
        self._draw_grid(width, height)
        self._draw_coordinate_system(44, height - 72)

        for index, member in enumerate(self.members, start=1):
            start = self._node_by_id(member.start_id)
            end = self._node_by_id(member.end_id)
            force = self.member_forces.get(index)
            beam_result = self.beam_results.get(index)
            self.create_line(start.x, start.y, end.x, end.y, fill=Theme.BEAM, width=4)
            if beam_result is not None:
                self._draw_beam_response_diagram(start, end, beam_result)
            elif force is not None:
                self._draw_member_response_diagram(start, end, force)

        for node_id, support_type in self.supports.items():
            node = self._node_by_id(node_id)
            self._draw_support(node.x, node.y, support_type)

        for node_id in self.free_ends:
            node = self._node_by_id(node_id)
            self._draw_free_end(node.x, node.y)

        for load in self.loads.values():
            node = self._node_by_id(load.node_id)
            self._draw_load(node.x, node.y, load.fx, load.fy)

        self._draw_reactions()

        if self.active_load_node_id is not None and self.preview_load_end is not None:
            node = self._node_by_id(self.active_load_node_id)
            end_x, end_y = self.preview_load_end
            self.create_line(
                node.x,
                node.y,
                end_x,
                end_y,
                fill=Theme.ORANGE,
                width=3,
                arrow=tk.LAST,
                arrowshape=(14, 18, 6),
            )

        for node in self.nodes:
            fill = Theme.BLUE if node.node_id == self.active_member_start else Theme.SURFACE
            self.create_oval(
                node.x - 8,
                node.y - 8,
                node.x + 8,
                node.y + 8,
                outline=Theme.BLUE,
                fill=fill,
                width=3,
            )
            self.create_text(
                node.x,
                node.y - 22,
                text=str(node.node_id),
                fill=Theme.MUTED,
                font=(Theme.FONT_FAMILY, 10, "bold"),
            )

    def _handle_press(self, event: tk.Event) -> None:
        x = self._snap(event.x)
        y = self._snap(event.y)
        tool = self.tool.get()

        if tool == "node":
            self._add_node(x, y)
        elif tool == "member":
            self._handle_member_tool(event.x, event.y)
        elif tool in {"pin", "roller", "fixed"}:
            self._set_support(event.x, event.y, tool)
        elif tool == "free":
            self._set_free_end(event.x, event.y)
        elif tool == "load":
            self._start_load(event.x, event.y)
        elif tool == "delete":
            self._delete_nearest(event.x, event.y)

        self.redraw()

    def _handle_drag(self, event: tk.Event) -> None:
        if self.tool.get() != "load" or self.active_load_node_id is None:
            return
        self.preview_load_end = (self._snap(event.x), self._snap(event.y))
        self.redraw()

    def _handle_release(self, event: tk.Event) -> None:
        if self.tool.get() != "load" or self.active_load_node_id is None:
            return
        self._finish_load(event.x, event.y)
        self.active_load_node_id = None
        self.preview_load_end = None
        self.redraw()

    def _add_node(self, x: float, y: float) -> None:
        if self._nearest_node(x, y, max_distance=18) is not None:
            self.status.set("Hier liegt schon ein Knoten.")
            return
        self.nodes.append(TrussNode(self.next_node_id, x, y))
        self._clear_results()
        self.status.set(f"Knoten {self.next_node_id} gesetzt.")
        self.next_node_id += 1

    def _handle_member_tool(self, x: float, y: float) -> None:
        node = self._nearest_node(x, y)
        if node is None:
            self.status.set("Für einen Stab zuerst einen Knoten anklicken.")
            return
        if self.active_member_start is None:
            self.active_member_start = node.node_id
            self.status.set(f"Startknoten {node.node_id} gewählt. Zweiten Knoten anklicken.")
            return
        if self.active_member_start == node.node_id:
            self.status.set("Start und Ende dürfen nicht derselbe Knoten sein.")
            return

        ids = {self.active_member_start, node.node_id}
        if any({member.start_id, member.end_id} == ids for member in self.members):
            self.status.set("Dieser Stab existiert schon.")
        else:
            self.members.append(TrussMember(self.active_member_start, node.node_id))
            self._clear_results()
            self.status.set(f"Stab {self.active_member_start}-{node.node_id} gesetzt.")
        self.active_member_start = None

    def _set_support(self, x: float, y: float, support_type: str) -> None:
        node = self._nearest_node(x, y)
        if node is None:
            self.status.set("Lager muss auf einen Knoten gesetzt werden.")
            return
        self.supports[node.node_id] = support_type
        self.free_ends.discard(node.node_id)
        self._clear_results()
        labels = {"pin": "Festlager", "roller": "Loslager", "fixed": "Einspannung"}
        label = labels[support_type]
        self.status.set(f"{label} an Knoten {node.node_id} gesetzt.")

    def _set_free_end(self, x: float, y: float) -> None:
        node = self._nearest_node(x, y)
        if node is None:
            self.status.set("Freies Ende muss auf einen vorhandenen Knoten gesetzt werden.")
            return
        self.supports.pop(node.node_id, None)
        self.free_ends.add(node.node_id)
        self._clear_results()
        self.status.set(f"Knoten {node.node_id} ist jetzt ein freies Ende.")

    def _start_load(self, x: float, y: float) -> None:
        node = self._nearest_node(x, y)
        if node is None:
            self.status.set(
                "Lasten müssen im Fachwerk an vorhandenen Knoten angreifen. "
                "Setze zuerst einen Knoten."
            )
            return
        self.active_load_node_id = node.node_id
        self.preview_load_end = (node.x, node.y + 48)
        self.status.set("Ziehe vom Knoten in Richtung der Last. Länge bestimmt den Betrag.")

    def _finish_load(self, x: float, y: float) -> None:
        if self.active_load_node_id is None:
            return
        node = self._node_by_id(self.active_load_node_id)
        end_x = self._snap(x)
        end_y = self._snap(y)
        dx = end_x - node.x
        dy = end_y - node.y
        if math.hypot(dx, dy) < self.snap:
            dx = 0.0
            dy = 2 * self.snap

        scale = 5.0 / self.snap
        fx = round(dx * scale, 2)
        fy = round(dy * scale, 2)
        self.loads[node.node_id] = TrussLoad(node_id=node.node_id, fx=fx, fy=fy)
        self._clear_results()
        self.status.set(
            f"Last an Knoten {node.node_id}: Fx={fx:g} kN, Fy={fy:g} kN "
            "(y positiv nach unten)."
        )

    def _delete_nearest(self, x: float, y: float) -> None:
        node = self._nearest_node(x, y)
        if node is None:
            self.status.set("Kein Knoten in der Nähe.")
            return
        node_id = node.node_id
        self.nodes = [item for item in self.nodes if item.node_id != node_id]
        self.members = [
            item
            for item in self.members
            if item.start_id != node_id and item.end_id != node_id
        ]
        self.supports.pop(node_id, None)
        self.free_ends.discard(node_id)
        self.loads.pop(node_id, None)
        if self.active_member_start == node_id:
            self.active_member_start = None
        self._clear_results()
        self.status.set(f"Knoten {node_id} gelöscht.")

    def _to_solver_model(self) -> TrussModel:
        return TrussModel(
            joints=[
                TrussJoint(node.node_id, node.x, node.y)
                for node in self.nodes
            ],
            bars=[
                TrussBar(index, member.start_id, member.end_id)
                for index, member in enumerate(self.members, start=1)
            ],
            loads=[
                JointLoad(load.node_id, load.fx, load.fy)
                for load in self.loads.values()
            ],
            supports=[
                JointSupport(node_id, support_type)
                for node_id, support_type in self.supports.items()
            ],
        )

    def _clear_results(self) -> None:
        self.member_forces = {}
        self.beam_results = {}
        self.reactions = {}

    def _cantilever_case(self) -> tuple[int, TrussMember, TrussNode, TrussNode, TrussLoad] | None:
        if len(self.members) != 1:
            return None
        member = self.members[0]
        start = self._node_by_id(member.start_id)
        end = self._node_by_id(member.end_id)

        start_fixed = self.supports.get(start.node_id) == "fixed"
        end_fixed = self.supports.get(end.node_id) == "fixed"
        start_free = start.node_id in self.free_ends
        end_free = end.node_id in self.free_ends

        if start_fixed and end_free:
            fixed = start
            free = end
        elif end_fixed and start_free:
            fixed = end
            free = start
        else:
            return None

        if set(self.loads) != {free.node_id}:
            return None

        return (1, member, fixed, free, self.loads[free.node_id])

    def _solve_cantilever(
        self,
        case: tuple[int, TrussMember, TrussNode, TrussNode, TrussLoad],
    ) -> None:
        member_index, _member, fixed, free, load = case
        dx = free.x - fixed.x
        dy = free.y - fixed.y
        length = math.hypot(dx, dy)
        if length <= 1e-9:
            self.status.set("Nicht lösbar: Kragträger hat Länge 0.")
            return

        ux = dx / length
        uy = dy / length
        nx = -uy
        ny = ux
        normal = load.fx * ux + load.fy * uy
        shear = load.fx * nx + load.fy * ny
        moment = shear * length / self.snap

        self.member_forces = {}
        self.beam_results = {
            member_index: BeamMemberResult(
                member_index=member_index,
                fixed_node_id=fixed.node_id,
                free_node_id=free.node_id,
                normal_force=normal,
                shear_force=shear,
                fixed_moment=moment,
            )
        }
        self.reactions = {
            f"rx:{fixed.node_id}": -load.fx,
            f"ry:{fixed.node_id}": -load.fy,
            f"mz:{fixed.node_id}": moment,
        }
        self.status.set(
            "Kragträger berechnet: N/Q/M sind jetzt als Balkenverläufe verfügbar."
        )
        self.redraw()

    def _nearest_node(
        self,
        x: float,
        y: float,
        max_distance: float = 20,
    ) -> TrussNode | None:
        nearest: TrussNode | None = None
        nearest_distance = max_distance
        for node in self.nodes:
            distance = math.hypot(node.x - x, node.y - y)
            if distance <= nearest_distance:
                nearest = node
                nearest_distance = distance
        return nearest

    def _node_by_id(self, node_id: int) -> TrussNode:
        return next(node for node in self.nodes if node.node_id == node_id)

    def _snap(self, value: float) -> float:
        return round(value / self.snap) * self.snap

    def _draw_grid(self, width: float, height: float) -> None:
        minor = self.snap
        major = minor * 4
        for x in range(0, int(width) + minor, minor):
            color = Theme.GRID_MAJOR if x % major == 0 else Theme.GRID_MINOR
            self.create_line(x, 0, x, height, fill=color)
        for y in range(0, int(height) + minor, minor):
            color = Theme.GRID_MAJOR if y % major == 0 else Theme.GRID_MINOR
            self.create_line(0, y, width, y, fill=color)

    def _draw_coordinate_system(self, x: float, y: float) -> None:
        self.create_line(x, y, x + 72, y, fill=Theme.TEXT, width=3, arrow=tk.LAST)
        self.create_line(x, y, x, y + 72, fill=Theme.TEXT, width=3, arrow=tk.LAST)
        self.create_text(x + 84, y, text="x", fill=Theme.TEXT, font=(Theme.FONT_FAMILY, 12, "bold"))
        self.create_text(x, y + 84, text="y", fill=Theme.TEXT, font=(Theme.FONT_FAMILY, 12, "bold"))

    def _draw_support(self, x: float, y: float, support_type: str) -> None:
        if support_type == "fixed":
            self._draw_fixed_support(x, y)
            return

        points = [x, y + 10, x - 17, y + 40, x + 17, y + 40]
        self.create_polygon(points, outline=Theme.BLUE, fill="#E8F0FF", width=2)
        if support_type == "roller":
            self.create_oval(x - 14, y + 42, x - 4, y + 52, outline=Theme.BLUE, width=2)
            self.create_oval(x + 4, y + 42, x + 14, y + 52, outline=Theme.BLUE, width=2)
            self.create_line(x - 24, y + 55, x + 24, y + 55, fill=Theme.BLUE, width=2)
        else:
            self.create_line(x - 23, y + 43, x + 23, y + 43, fill=Theme.BLUE, width=2)

    def _draw_free_end(self, x: float, y: float) -> None:
        self.create_line(x - 12, y - 16, x + 12, y - 16, fill=Theme.MUTED, width=2)
        self.create_text(
            x,
            y - 36,
            text="frei",
            fill=Theme.MUTED,
            font=(Theme.FONT_FAMILY, 10, "bold"),
        )

    def _draw_fixed_support(self, x: float, y: float) -> None:
        wall_x = x - 20
        self.create_line(wall_x, y - 44, wall_x, y + 44, fill=Theme.BLUE, width=5)
        self.create_line(wall_x, y, x + 12, y, fill=Theme.BLUE, width=5)
        for offset in range(-42, 48, 12):
            self.create_line(
                wall_x - 18,
                y + offset + 10,
                wall_x,
                y + offset,
                fill=Theme.BLUE,
                width=2,
            )

    def _draw_load(self, x: float, y: float, force_x: float, force_y: float) -> None:
        scale = self.snap / 5.0
        end_x = x + force_x * scale
        end_y = y + force_y * scale
        self.create_line(
            x,
            y,
            end_x,
            end_y,
            fill=Theme.RED,
            width=3,
            arrow=tk.LAST,
            arrowshape=(14, 18, 6),
        )
        label_x = (x + end_x) / 2 + 10
        label_y = (y + end_y) / 2 - 10
        self.create_text(
            label_x,
            label_y,
            anchor="w",
            text=f"({force_x:g}, {force_y:g}) kN",
            fill=Theme.RED,
            font=(Theme.FONT_FAMILY, 11, "bold"),
        )

    def _draw_reactions(self) -> None:
        for name, value in self.reactions.items():
            axis, raw_node_id = name.split(":")
            node = self._node_by_id(int(raw_node_id))
            if axis == "mz":
                self._draw_moment_reaction(node.x, node.y, value)
                continue
            force_x = value if axis == "rx" else 0.0
            force_y = value if axis == "ry" else 0.0
            if abs(force_x) <= 1e-6 and abs(force_y) <= 1e-6:
                continue
            scale = self.snap / 5.0
            end_x = node.x + force_x * scale
            end_y = node.y + force_y * scale
            self.create_line(
                node.x,
                node.y,
                end_x,
                end_y,
                fill=Theme.BLUE,
                width=3,
                arrow=tk.LAST,
                arrowshape=(14, 18, 6),
            )
            self.create_text(
                end_x + 8,
                end_y,
                anchor="w",
                text=f"{axis.upper()}={value:+.2f}",
                fill=Theme.BLUE,
                font=(Theme.FONT_FAMILY, 10, "bold"),
            )

    def _draw_moment_reaction(self, x: float, y: float, value: float) -> None:
        extent = 250 if value >= 0 else -250
        self.create_arc(
            x - 42,
            y - 42,
            x + 42,
            y + 42,
            start=25,
            extent=extent,
            outline=Theme.RED,
            width=3,
            style=tk.ARC,
        )
        self.create_text(
            x - 4,
            y - 54,
            text=f"MZ={value:+.2f}",
            fill=Theme.RED,
            font=(Theme.FONT_FAMILY, 10, "bold"),
        )

    def _draw_member_response_diagram(
        self,
        start: TrussNode,
        end: TrussNode,
        force: float,
    ) -> None:
        mode = self.response_mode.get()
        if mode in {"M", "Q"}:
            self._draw_zero_response(start, end, mode)
            return

        if abs(force) <= 1e-6:
            self._draw_zero_response(start, end, "N")
            return

        dx = end.x - start.x
        dy = end.y - start.y
        length = math.hypot(dx, dy)
        if length <= 1e-9:
            return
        nx = -dy / length
        ny = dx / length
        sign = 1 if force > 0 else -1
        offset = sign * min(62.0, 18.0 + abs(force) * 3.0)
        sx = start.x + nx * offset
        sy = start.y + ny * offset
        ex = end.x + nx * offset
        ey = end.y + ny * offset
        fill = "#E4F4EA" if force > 0 else "#FFF0DF"
        outline = Theme.GREEN if force > 0 else Theme.ORANGE

        self.create_polygon(
            start.x,
            start.y,
            end.x,
            end.y,
            ex,
            ey,
            sx,
            sy,
            fill=fill,
            outline=outline,
            width=2,
        )
        self.create_line(sx, sy, ex, ey, fill=outline, width=3)
        self._draw_response_label(
            (start.x + end.x + sx + ex) / 4,
            (start.y + end.y + sy + ey) / 4,
            "+" if force > 0 else "-",
            outline,
        )
        self._draw_value_label(
            (sx + ex) / 2,
            (sy + ey) / 2,
            f"N={force:+.2f}",
            outline,
        )

    def _draw_beam_response_diagram(
        self,
        _start: TrussNode,
        _end: TrussNode,
        result: BeamMemberResult,
    ) -> None:
        fixed = self._node_by_id(result.fixed_node_id)
        free = self._node_by_id(result.free_node_id)
        mode = self.response_mode.get()
        if mode == "N":
            self._draw_constant_beam_response(fixed, free, result.normal_force, "N")
        elif mode == "Q":
            self._draw_constant_beam_response(fixed, free, result.shear_force, "Q")
        else:
            self._draw_moment_beam_response(fixed, free, result.fixed_moment)

    def _draw_constant_beam_response(
        self,
        fixed: TrussNode,
        free: TrussNode,
        value: float,
        mode: str,
    ) -> None:
        if abs(value) <= 1e-6:
            self._draw_zero_response(fixed, free, mode)
            return

        color = {"N": Theme.GREEN, "Q": Theme.PURPLE}[mode]
        fill = "#E4F4EA" if mode == "N" and value > 0 else "#F0EAFE"
        if mode == "N" and value < 0:
            fill = "#FFF0DF"
            color = Theme.ORANGE

        sx, sy, ex, ey = self._offset_line(fixed, free, value)
        self.create_polygon(
            fixed.x,
            fixed.y,
            free.x,
            free.y,
            ex,
            ey,
            sx,
            sy,
            fill=fill,
            outline=color,
            width=2,
        )
        self.create_line(sx, sy, ex, ey, fill=color, width=3)
        self._draw_response_label(
            (fixed.x + free.x + sx + ex) / 4,
            (fixed.y + free.y + sy + ey) / 4,
            "+" if value > 0 else "-",
            color,
        )
        self._draw_value_label((sx + ex) / 2, (sy + ey) / 2, f"{mode}={value:+.2f}", color)

    def _draw_moment_beam_response(
        self,
        fixed: TrussNode,
        free: TrussNode,
        value: float,
    ) -> None:
        if abs(value) <= 1e-6:
            self._draw_zero_response(fixed, free, "M")
            return

        sx, sy, _ex, _ey = self._offset_line(fixed, free, value)
        color = Theme.RED
        fill = "#FDECEC"
        self.create_polygon(
            fixed.x,
            fixed.y,
            free.x,
            free.y,
            sx,
            sy,
            fill=fill,
            outline=color,
            width=2,
        )
        self.create_line(sx, sy, free.x, free.y, fill=color, width=3)
        self._draw_response_label(
            (fixed.x + free.x + sx) / 3,
            (fixed.y + free.y + sy) / 3,
            "+" if value > 0 else "-",
            color,
        )
        self._draw_value_label(sx, sy, f"M={value:+.2f}", color)

    def _offset_line(
        self,
        start: TrussNode,
        end: TrussNode,
        value: float,
    ) -> tuple[float, float, float, float]:
        dx = end.x - start.x
        dy = end.y - start.y
        length = math.hypot(dx, dy)
        if length <= 1e-9:
            return start.x, start.y, end.x, end.y
        nx = -dy / length
        ny = dx / length
        sign = 1 if value > 0 else -1
        offset = sign * min(72.0, 22.0 + abs(value) * 2.6)
        return (
            start.x + nx * offset,
            start.y + ny * offset,
            end.x + nx * offset,
            end.y + ny * offset,
        )

    def _draw_zero_response(self, start: TrussNode, end: TrussNode, mode: str) -> None:
        color = {"M": Theme.RED, "Q": Theme.PURPLE, "N": Theme.GREEN}[mode]
        mid_x = (start.x + end.x) / 2
        mid_y = (start.y + end.y) / 2
        self.create_line(
            start.x,
            start.y,
            end.x,
            end.y,
            fill=color,
            width=2,
            dash=(5, 5),
        )
        self._draw_value_label(mid_x, mid_y - 20, f"{mode}=0", color)

    def _draw_response_label(self, x: float, y: float, text: str, color: str) -> None:
        radius = 13
        self.create_oval(
            x - radius,
            y - radius,
            x + radius,
            y + radius,
            fill=Theme.PAPER,
            outline=color,
            width=2,
        )
        self.create_text(
            x,
            y,
            text=text,
            fill=color,
            font=(Theme.FONT_FAMILY, 15, "bold"),
        )

    def _draw_value_label(self, x: float, y: float, label: str, color: str) -> None:
        self.create_rectangle(
            x - 44,
            y - 13,
            x + 44,
            y + 13,
            fill=Theme.PAPER,
            outline=Theme.BORDER,
        )
        self.create_text(
            x,
            y,
            text=label,
            fill=color,
            font=(Theme.FONT_FAMILY, 10, "bold"),
        )
