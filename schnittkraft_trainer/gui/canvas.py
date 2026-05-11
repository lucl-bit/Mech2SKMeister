from __future__ import annotations

import tkinter as tk

from schnittkraft_trainer.game.diagram_challenges import (
    DiagramChallenge,
    DiagramKind,
    DiagramOption,
    FrameVisual,
    TrussVisual,
)
from schnittkraft_trainer.gui.theme import Theme
from schnittkraft_trainer.model.support import SupportType


class ChallengeCanvas(tk.Canvas):
    """Notebook-style canvas for choosing the correct internal-force diagram."""

    def __init__(self, master: tk.Misc, **kwargs: object) -> None:
        super().__init__(
            master,
            bg=Theme.PAPER,
            highlightthickness=0,
            **kwargs,
        )
        self.challenge: DiagramChallenge | None = None
        self.selected_option_id: str | None = None
        self.checked_option_id: str | None = None
        self.option_boxes: dict[str, tuple[float, float, float, float]] = {}
        self.on_option_selected: callable[[str], None] | None = None
        self.bind("<Configure>", lambda _event: self.redraw())
        self.bind("<Button-1>", self._handle_click)

    def set_challenge(self, challenge: DiagramChallenge) -> None:
        self.challenge = challenge
        self.selected_option_id = None
        self.checked_option_id = None
        self.redraw()

    def mark_selection(self, option_id: str, checked: bool = False) -> None:
        self.selected_option_id = option_id
        self.checked_option_id = option_id if checked else None
        self.redraw()

    def redraw(self) -> None:
        self.delete("all")
        self.option_boxes = {}
        width = max(self.winfo_width(), 760)
        height = max(self.winfo_height(), 560)
        self._draw_grid(width, height)
        self._draw_coordinate_system(44, height - 58)

        if self.challenge is None:
            return

        self._draw_header(width)
        if self.challenge.challenge_type == "truss":
            self._draw_truss_system(width, y=122)
        elif self.challenge.challenge_type == "frame":
            self._draw_frame_system(width, y=122)
        else:
            self._draw_beam(width, y=118)
        self._draw_options(width, height)

    def _draw_grid(self, width: float, height: float) -> None:
        minor = 24
        major = minor * 4
        for x in range(0, int(width) + minor, minor):
            color = Theme.GRID_MAJOR if x % major == 0 else Theme.GRID_MINOR
            self.create_line(x, 0, x, height, fill=color)
        for y in range(0, int(height) + minor, minor):
            color = Theme.GRID_MAJOR if y % major == 0 else Theme.GRID_MINOR
            self.create_line(0, y, width, y, fill=color)

    def _draw_header(self, width: float) -> None:
        assert self.challenge is not None
        self.create_text(
            42,
            34,
            anchor="w",
            text=self.challenge.diagram_kind.value,
            fill=self._diagram_color(),
            font=(Theme.FONT_FAMILY, 44, "bold"),
        )
        self.create_text(
            108,
            35,
            anchor="w",
            text=self.challenge.title,
            fill=Theme.TEXT,
            font=(Theme.FONT_FAMILY, 18, "bold"),
        )
        self.create_text(
            width - 42,
            35,
            anchor="e",
            text="Wähle A, B oder C",
            fill=Theme.MUTED,
            font=(Theme.FONT_FAMILY, 12, "bold"),
        )

    def _draw_beam(self, width: float, y: float) -> None:
        assert self.challenge is not None
        assert self.challenge.beam is not None
        beam = self.challenge.beam
        start = 150
        end = width - 190
        scale = (end - start) / beam.length

        def sx(x: float) -> float:
            return start + x * scale

        self.create_line(start, y, end, y, fill=Theme.BEAM, width=5)
        self.create_line(start, y - 9, end, y - 9, fill=Theme.MUTED, width=2, dash=(5, 5))

        for support in beam.supports:
            self._draw_support(sx(support.x), y, support.label)

        if self.challenge.system_type == "cantilever_left":
            self.create_text(
                end,
                y + 34,
                text="freies Ende",
                fill=Theme.MUTED,
                font=(Theme.FONT_FAMILY, 11, "bold"),
            )

        for load in beam.point_loads:
            x = sx(load.x)
            self.create_line(
                x,
                y - 72,
                x,
                y - 14,
                fill=Theme.LOAD,
                width=3,
                arrow=tk.LAST,
                arrowshape=(14, 18, 6),
            )
            self.create_text(
                x + 12,
                y - 68,
                anchor="w",
                text=f"{abs(load.force_y):g} kN",
                fill=Theme.LOAD,
                font=(Theme.FONT_FAMILY, 12, "bold"),
            )

    def _draw_support(self, x: float, y: float, label: str) -> None:
        assert self.challenge is not None
        assert self.challenge.beam is not None
        support = next(
            item for item in self.challenge.beam.supports if abs(self._support_canvas_x(item.x) - x) < 1e-6
        )
        if support.support_type is SupportType.FIXED:
            self._draw_fixed_support(x, y, label)
            return

        points = [x, y + 8, x - 16, y + 36, x + 16, y + 36]
        self.create_polygon(points, outline=Theme.BEAM, fill="#F8FAFE", width=2)
        if support.support_type is SupportType.ROLLER:
            self.create_oval(x - 15, y + 39, x - 5, y + 49, outline=Theme.BEAM, width=2)
            self.create_oval(x + 5, y + 39, x + 15, y + 49, outline=Theme.BEAM, width=2)
            self.create_line(x - 24, y + 52, x + 24, y + 52, fill=Theme.BEAM, width=2)
        else:
            self.create_line(x - 22, y + 39, x + 22, y + 39, fill=Theme.BEAM, width=2)
        self.create_text(
            x,
            y + 58,
            text=label,
            fill=Theme.MUTED,
            font=(Theme.FONT_FAMILY, 11, "bold"),
        )

    def _support_canvas_x(self, support_x: float) -> float:
        assert self.challenge is not None
        assert self.challenge.beam is not None
        width = max(self.winfo_width(), 760)
        start = 150
        end = width - 190
        return start + support_x * ((end - start) / self.challenge.beam.length)

    def _draw_truss_system(self, width: float, y: float) -> None:
        assert self.challenge is not None
        assert self.challenge.truss is not None
        points = self._visual_points(self.challenge.truss, 150, y, width - 190, y + 92)

        for bar in self.challenge.truss.bars:
            start = points[bar.start_id]
            end = points[bar.end_id]
            self.create_line(start[0], start[1], end[0], end[1], fill=Theme.BEAM, width=5)

        for support in self.challenge.truss.supports:
            x, node_y = points[support.joint_id]
            if support.support_type == "roller":
                self._draw_simple_roller(x, node_y)
            else:
                self._draw_simple_pin(x, node_y)

        for load in self.challenge.truss.loads:
            x, node_y = points[load.joint_id]
            end_x = x + load.fx * 4
            end_y = node_y + load.fy * 4
            self.create_line(
                x,
                node_y,
                end_x,
                end_y,
                fill=Theme.LOAD,
                width=3,
                arrow=tk.LAST,
                arrowshape=(14, 18, 6),
            )
            self.create_text(
                end_x + 10,
                end_y - 8,
                anchor="w",
                text=f"{abs(load.fy):g} kN",
                fill=Theme.LOAD,
                font=(Theme.FONT_FAMILY, 12, "bold"),
            )

        for joint in self.challenge.truss.joints:
            x, node_y = points[joint.joint_id]
            self.create_oval(
                x - 7,
                node_y - 7,
                x + 7,
                node_y + 7,
                fill=Theme.PAPER,
                outline=Theme.BLUE,
                width=3,
            )

    def _draw_simple_pin(self, x: float, y: float) -> None:
        points = [x, y + 10, x - 16, y + 38, x + 16, y + 38]
        self.create_polygon(points, outline=Theme.BEAM, fill="#F8FAFE", width=2)
        self.create_line(x - 23, y + 41, x + 23, y + 41, fill=Theme.BEAM, width=2)

    def _draw_simple_roller(self, x: float, y: float) -> None:
        self._draw_simple_pin(x, y)
        self.create_oval(x - 14, y + 43, x - 4, y + 53, outline=Theme.BEAM, width=2)
        self.create_oval(x + 4, y + 43, x + 14, y + 53, outline=Theme.BEAM, width=2)

    def _draw_fixed_support(self, x: float, y: float, label: str) -> None:
        wall_x = x - 18
        self.create_line(wall_x, y - 46, wall_x, y + 46, fill=Theme.BEAM, width=5)
        for offset in range(-42, 47, 12):
            self.create_line(
                wall_x - 18,
                y + offset + 10,
                wall_x,
                y + offset,
                fill=Theme.BEAM,
                width=2,
            )
        self.create_line(wall_x, y, x + 18, y, fill=Theme.BEAM, width=5)
        self.create_text(
            wall_x - 8,
            y + 66,
            text=label,
            fill=Theme.MUTED,
            font=(Theme.FONT_FAMILY, 11, "bold"),
        )

    def _draw_options(self, width: float, height: float) -> None:
        assert self.challenge is not None
        box_width = min(480, width * 0.52)
        box_height = 78
        x0 = (width - box_width) / 2
        start_y = max(235, height * 0.36)
        gap = 72

        for index, option in enumerate(self.challenge.options):
            y0 = start_y + index * (box_height + gap)
            self._draw_option(option, x0, y0, box_width, box_height)

    def _draw_option(
        self,
        option: DiagramOption,
        x: float,
        y: float,
        width: float,
        height: float,
    ) -> None:
        selected = option.option_id == self.selected_option_id
        checked = self.checked_option_id is not None
        if checked and option.is_correct:
            outline = Theme.GREEN
            line_width = 5
        elif checked and selected and not option.is_correct:
            outline = Theme.RED
            line_width = 5
        elif selected:
            outline = Theme.BLUE
            line_width = 4
        else:
            outline = Theme.BORDER
            line_width = 2
        self.option_boxes[option.option_id] = (x, y, x + width, y + height)

        self.create_rectangle(
            x,
            y,
            x + width,
            y + height,
            outline=outline,
            width=line_width,
            fill=Theme.PAPER,
        )
        self.create_text(
            x - 34,
            y + height / 2,
            text=option.label,
            fill=Theme.TEXT,
            font=(Theme.FONT_FAMILY, 20, "bold"),
        )
        mid_y = y + height / 2
        self.create_line(x + 10, mid_y, x + width - 10, mid_y, fill=Theme.MUTED, width=2, dash=(5, 4))
        self._draw_shape(option.shape, x, y, width, height)

    def _draw_shape(self, shape: str, x: float, y: float, width: float, height: float) -> None:
        left = x + 12
        right = x + width - 12
        center = y + height / 2
        top = y + 10
        bottom = y + height - 10
        color = self._diagram_color()
        load_ratio = self._load_ratio()
        load_at = left + (right - left) * load_ratio

        if shape.startswith("truss:"):
            self._draw_line_system_option(shape, x, y, width, height, system="truss")
        elif shape.startswith("frame:"):
            self._draw_line_system_option(shape, x, y, width, height, system="frame")
        elif shape == "zero":
            self.create_line(left, center, right, center, fill=color, width=3)
        elif shape == "constant_positive":
            self.create_line(left, top, right, top, fill=color, width=3)
            self.create_line(left, top, left, center, fill=color, width=3)
            self.create_line(right, top, right, center, fill=color, width=3)
        elif shape == "constant_negative":
            self.create_line(left, bottom, right, bottom, fill=color, width=3)
            self.create_line(left, center, left, bottom, fill=color, width=3)
            self.create_line(right, center, right, bottom, fill=color, width=3)
        elif shape == "shear_positive_then_negative":
            mid = load_at
            self.create_line(left, top, mid, top, fill=color, width=3)
            self.create_line(mid, top, mid, bottom, fill=color, width=3)
            self.create_line(mid, bottom, right, bottom, fill=color, width=3)
            self._draw_sign_badge((left + mid) / 2, top + 16, "+", color)
            self._draw_sign_badge((mid + right) / 2, bottom - 16, "-", color)
        elif shape == "shear_negative_then_positive":
            mid = load_at
            self.create_line(left, bottom, mid, bottom, fill=color, width=3)
            self.create_line(mid, bottom, mid, top, fill=color, width=3)
            self.create_line(mid, top, right, top, fill=color, width=3)
            self._draw_sign_badge((left + mid) / 2, bottom - 16, "-", color)
            self._draw_sign_badge((mid + right) / 2, top + 16, "+", color)
        elif shape == "shear_positive_then_zero":
            mid = load_at
            self.create_line(left, top, mid, top, fill=color, width=3)
            self.create_line(mid, top, mid, center, fill=color, width=3)
            self.create_line(mid, center, right, center, fill=color, width=3)
            self._draw_sign_badge((left + mid) / 2, top + 16, "+", color)
        elif shape == "shear_negative_then_zero":
            mid = load_at
            self.create_line(left, bottom, mid, bottom, fill=color, width=3)
            self.create_line(mid, bottom, mid, center, fill=color, width=3)
            self.create_line(mid, center, right, center, fill=color, width=3)
            self._draw_sign_badge((left + mid) / 2, bottom - 16, "-", color)
        elif shape == "moment_triangle_positive":
            mid = (left + right) / 2
            self.create_line(left, center, mid, top, right, center, fill=color, width=3)
            self._draw_sign_badge(mid, top + 16, "+", color)
        elif shape == "moment_triangle_negative":
            mid = (left + right) / 2
            self.create_line(left, center, mid, bottom, right, center, fill=color, width=3)
            self._draw_sign_badge(mid, bottom - 16, "-", color)
        elif shape == "moment_peak_left_positive":
            peak = load_at
            self.create_line(left, center, peak, top, right, center, fill=color, width=3)
            self._draw_sign_badge(peak, top + 16, "+", color)
        elif shape == "moment_peak_left_negative":
            peak = load_at
            self.create_line(left, center, peak, bottom, right, center, fill=color, width=3)
            self._draw_sign_badge(peak, bottom - 16, "-", color)
        elif shape == "moment_peak_right_positive":
            peak = load_at
            self.create_line(left, center, peak, top, right, center, fill=color, width=3)
            self._draw_sign_badge(peak, top + 16, "+", color)
        elif shape == "moment_peak_right_negative":
            peak = load_at
            self.create_line(left, center, peak, bottom, right, center, fill=color, width=3)
            self._draw_sign_badge(peak, bottom - 16, "-", color)
        elif shape == "moment_cantilever_positive":
            mid = load_at
            self.create_line(left, top, mid, center, right, center, fill=color, width=3)
            self._draw_sign_badge((left + mid) / 2, top + 16, "+", color)
        elif shape == "moment_cantilever_negative":
            mid = load_at
            self.create_line(left, bottom, mid, center, right, center, fill=color, width=3)
            self._draw_sign_badge((left + mid) / 2, bottom - 16, "-", color)
        elif shape == "triangle_positive":
            self.create_line(left, center, right, top, right, center, fill=color, width=3)

        if shape in {"constant_positive", "triangle_positive"}:
            self._draw_sign_badge((left + right) / 2, top + 16, "+", color)
        elif shape == "constant_negative":
            self._draw_sign_badge((left + right) / 2, bottom - 16, "-", color)

    def _draw_frame_system(self, width: float, y: float) -> None:
        assert self.challenge is not None
        assert self.challenge.frame is not None
        points = self._visual_points(self.challenge.frame, 150, y, width - 190, y + 105)

        for bar in self.challenge.frame.bars:
            start = points[bar.start_id]
            end = points[bar.end_id]
            self.create_line(start[0], start[1], end[0], end[1], fill=Theme.BEAM, width=6)

        for support in self.challenge.frame.supports:
            x, node_y = points[support.joint_id]
            if support.support_type == "fixed":
                self._draw_small_fixed(x, node_y)
            elif support.support_type == "roller":
                self._draw_simple_roller(x, node_y)
            else:
                self._draw_simple_pin(x, node_y)

        for bar in self.challenge.frame.bars:
            if bar.bar_id in self.challenge.frame.distributed_bars:
                start = points[bar.start_id]
                end = points[bar.end_id]
                self._draw_distributed_load(start, end)

        for load in self.challenge.frame.loads:
            x, node_y = points[load.joint_id]
            self.create_line(
                x,
                node_y - 54,
                x,
                node_y - 10,
                fill=Theme.LOAD,
                width=3,
                arrow=tk.LAST,
                arrowshape=(14, 18, 6),
            )
            self.create_text(
                x + 10,
                node_y - 48,
                anchor="w",
                text="F",
                fill=Theme.LOAD,
                font=(Theme.FONT_FAMILY, 12, "bold"),
            )

        for joint in self.challenge.frame.joints:
            x, node_y = points[joint.joint_id]
            self.create_oval(x - 5, node_y - 5, x + 5, node_y + 5, fill=Theme.PAPER, outline=Theme.BEAM)

    def _draw_small_fixed(self, x: float, y: float) -> None:
        wall_x = x - 16
        self.create_line(wall_x, y - 35, wall_x, y + 35, fill=Theme.BEAM, width=4)
        for offset in range(-30, 36, 12):
            self.create_line(wall_x - 13, y + offset + 8, wall_x, y + offset, fill=Theme.BEAM, width=2)

    def _draw_distributed_load(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
    ) -> None:
        count = 5
        for index in range(count):
            t = (index + 0.5) / count
            x = start[0] + (end[0] - start[0]) * t
            y = start[1] + (end[1] - start[1]) * t
            self.create_line(x, y - 40, x, y - 8, fill=Theme.LOAD, width=2, arrow=tk.LAST)
        self.create_text((start[0] + end[0]) / 2, start[1] - 48, text="q", fill=Theme.LOAD, font=(Theme.FONT_FAMILY, 13, "bold"))

    def _draw_line_system_option(
        self,
        shape: str,
        x: float,
        y: float,
        width: float,
        height: float,
        system: str,
    ) -> None:
        assert self.challenge is not None
        visual = self.challenge.truss if system == "truss" else self.challenge.frame
        assert visual is not None
        signs = self._decode_option_signs(shape.split(":", maxsplit=1)[1])
        points = self._visual_points(
            visual,
            x + 34,
            y + 14,
            x + width - 34,
            y + height - 14,
        )

        for bar in visual.bars:
            start = points[bar.start_id]
            end = points[bar.end_id]
            self.create_line(start[0], start[1], end[0], end[1], fill=Theme.BEAM, width=4 if system == "frame" else 3)

        for index, bar in enumerate(visual.bars):
            sign = signs[index] if index < len(signs) else 0
            start = points[bar.start_id]
            end = points[bar.end_id]
            self._draw_member_area(start, end, sign)

        for joint in visual.joints:
            px, py = points[joint.joint_id]
            self.create_oval(px - 4, py - 4, px + 4, py + 4, fill=Theme.PAPER, outline=Theme.BLUE)

    def _draw_member_area(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
        sign: int,
    ) -> None:
        if sign == 0:
            self.create_line(start[0], start[1], end[0], end[1], fill=Theme.GREEN, dash=(4, 3), width=2)
            return
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        length = (dx * dx + dy * dy) ** 0.5
        if length <= 1e-9:
            return
        nx = -dy / length
        ny = dx / length
        offset = sign * 13
        sx = start[0] + nx * offset
        sy = start[1] + ny * offset
        ex = end[0] + nx * offset
        ey = end[1] + ny * offset
        color = Theme.GREEN if sign > 0 else Theme.ORANGE
        fill = "#E4F4EA" if sign > 0 else "#FFF0DF"
        self.create_polygon(
            start[0],
            start[1],
            end[0],
            end[1],
            ex,
            ey,
            sx,
            sy,
            fill=fill,
            outline=color,
            width=1,
        )
        self.create_line(sx, sy, ex, ey, fill=color, width=2)
        self._draw_sign_badge((start[0] + end[0] + sx + ex) / 4, (start[1] + end[1] + sy + ey) / 4, "+" if sign > 0 else "-", color)

    def _visual_points(
        self,
        visual: TrussVisual | FrameVisual,
        left: float,
        top: float,
        right: float,
        bottom: float,
    ) -> dict[int, tuple[float, float]]:
        min_x = min(joint.x for joint in visual.joints)
        max_x = max(joint.x for joint in visual.joints)
        min_y = min(joint.y for joint in visual.joints)
        max_y = max(joint.y for joint in visual.joints)
        span_x = max(max_x - min_x, 1.0)
        span_y = max(max_y - min_y, 1.0)
        return {
            joint.joint_id: (
                left + (joint.x - min_x) / span_x * (right - left),
                top + (joint.y - min_y) / span_y * (bottom - top),
            )
            for joint in visual.joints
        }

    def _decode_option_signs(self, encoded: str) -> tuple[int, ...]:
        return tuple(1 if char == "p" else -1 if char == "m" else 0 for char in encoded)

    def _draw_sign_badge(self, x: float, y: float, text: str, color: str) -> None:
        self.create_oval(x - 9, y - 9, x + 9, y + 9, fill=Theme.PAPER, outline=color, width=2)
        self.create_text(x, y, text=text, fill=color, font=(Theme.FONT_FAMILY, 10, "bold"))

    def _draw_coordinate_system(self, x: float, y: float) -> None:
        self.create_line(x, y, x + 72, y, fill=Theme.TEXT, width=3, arrow=tk.LAST)
        self.create_line(x, y, x, y + 72, fill=Theme.TEXT, width=3, arrow=tk.LAST)
        self.create_text(x + 84, y, text="x", fill=Theme.TEXT, font=(Theme.FONT_FAMILY, 12, "bold"))
        self.create_text(x, y + 84, text="y", fill=Theme.TEXT, font=(Theme.FONT_FAMILY, 12, "bold"))

    def _handle_click(self, event: tk.Event) -> None:
        for option_id, (x0, y0, x1, y1) in self.option_boxes.items():
            if x0 <= event.x <= x1 and y0 <= event.y <= y1:
                self.selected_option_id = option_id
                self.redraw()
                if self.on_option_selected is not None:
                    self.on_option_selected(option_id)
                return

    def _diagram_color(self) -> str:
        if self.challenge is None:
            return Theme.TEXT
        if self.challenge.diagram_kind is DiagramKind.NORMAL:
            return Theme.GREEN
        if self.challenge.diagram_kind is DiagramKind.SHEAR:
            return Theme.PURPLE
        return Theme.RED

    def _load_ratio(self) -> float:
        if self.challenge is None or self.challenge.beam is None or not self.challenge.beam.point_loads:
            return 0.5
        load = self.challenge.beam.point_loads[0]
        return load.x / self.challenge.beam.length
