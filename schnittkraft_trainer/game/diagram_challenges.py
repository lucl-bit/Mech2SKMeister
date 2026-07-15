from __future__ import annotations

import random
from dataclasses import dataclass
from enum import Enum

from schnittkraft_trainer.mechanics.sign_convention import SignConvention
from schnittkraft_trainer.mechanics.solver import solve_support_reactions
from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)
from schnittkraft_trainer.model.load import DistributedLoad, PointLoad
from schnittkraft_trainer.model.structure import Beam
from schnittkraft_trainer.model.support import Support, SupportType


class DiagramKind(str, Enum):
    NORMAL = "N"
    SHEAR = "Q"
    MOMENT = "M"


@dataclass(frozen=True)
class DiagramOption:
    option_id: str
    label: str
    shape: str
    is_correct: bool = False


@dataclass(frozen=True)
class TrussVisual:
    joints: list[TrussJoint]
    bars: list[TrussBar]
    loads: list[JointLoad]
    supports: list[JointSupport]


@dataclass(frozen=True)
class FrameVisual:
    joints: list[TrussJoint]
    bars: list[TrussBar]
    loads: list[JointLoad]
    supports: list[JointSupport]
    distributed_bars: list[int]


@dataclass(frozen=True)
class DiagramChallenge:
    title: str
    level: int
    challenge_type: str
    beam: Beam | None
    diagram_kind: DiagramKind
    system_type: str
    options: list[DiagramOption]
    correct_option_id: str
    explanation: str
    truss: TrussVisual | None = None
    frame: FrameVisual | None = None


def generate_game_challenge(
    convention: SignConvention,
    challenge_number: int,
    seed: int | None = None,
) -> DiagramChallenge:
    if challenge_number <= 10:
        return generate_beam_challenge(convention, level=challenge_number, seed=seed)
    if challenge_number >= 21:
        return generate_frame_challenge(
            convention,
            level=challenge_number,
            difficulty=1 + max(0, challenge_number - 21) // 5,
            seed=seed,
        )
    return generate_truss_challenge(
        convention,
        level=challenge_number,
        difficulty=1 + max(0, challenge_number - 11) // 5,
        seed=seed,
    )


def generate_frame_challenge(
    convention: SignConvention,
    level: int = 21,
    difficulty: int = 1,
    seed: int | None = None,
) -> DiagramChallenge:
    rng = random.Random(seed)
    frame, sign_library = _frame_template(difficulty, rng)
    diagram_kind = rng.choice([DiagramKind.NORMAL, DiagramKind.SHEAR, DiagramKind.MOMENT])
    signs = _apply_frame_convention(sign_library[diagram_kind], diagram_kind, convention)
    correct_shape = f"frame:{_encode_signs(signs)}"
    shapes = [correct_shape]
    shapes.extend(f"frame:{_encode_signs(item)}" for item in _wrong_sign_patterns(signs))
    shapes = shapes[:3]
    rng.shuffle(shapes)

    options = [
        DiagramOption(
            option_id=chr(ord("A") + index),
            label=chr(ord("A") + index),
            shape=shape,
            is_correct=shape == correct_shape,
        )
        for index, shape in enumerate(shapes)
    ]
    correct_id = next(option.option_id for option in options if option.is_correct)

    return DiagramChallenge(
        title=f"Wähle die richtigen {diagram_kind.value}-Vorzeichen im Rahmen",
        level=level,
        challenge_type="frame",
        beam=None,
        diagram_kind=diagram_kind,
        system_type="frame",
        options=options,
        correct_option_id=correct_id,
        explanation=(
            "Rahmenstäbe können N, Q und M tragen. "
            "Die Flächen zeigen die Vorzeichenbereiche nach deiner Konvention."
        ),
        frame=frame,
    )


def generate_beam_challenge(
    convention: SignConvention,
    level: int = 1,
    seed: int | None = None,
) -> DiagramChallenge:
    rng = random.Random(seed)

    # Wider variety of system types
    system_type = rng.choice([
        "pin_roller", "pin_roller", "pin_roller",
        "cantilever_left", "cantilever_left",
        "pin_roller_sym",
    ])
    if system_type == "pin_roller_sym":
        system_type = "pin_roller"

    # Pilot: distributed-load variant only on simply-supported beams in The Basics.
    use_distributed = (
        system_type == "pin_roller"
        and 1 <= level <= 10
        and rng.random() < 0.30
    )
    if use_distributed:
        return _generate_distributed_beam_challenge(convention, level, rng)

    # Random length & load position (not only mid/quarter/three-quarter) for wider variety.
    length = round(rng.uniform(4.0, 8.0) * 2) / 2  # 0.5 m steps in [4, 8]
    load_x = round(rng.uniform(0.2 * length, 0.8 * length) * 2) / 2
    if load_x <= 0 or load_x >= length:
        load_x = length / 2
    load_value = float(rng.choice([5.0, 6.0, 7.0, 8.0, 10.0, 12.0, 14.0]))

    # Decide if we add a horizontal force component (for N ≠ 0)
    add_horizontal = rng.random() < 0.45
    horiz_value = rng.choice([6.0, 8.0, 10.0]) if add_horizontal else 0.0
    horiz_sign = rng.choice([1, -1]) if add_horizontal else 1

    force_x = horiz_sign * horiz_value if add_horizontal else 0.0
    force_y = -load_value  # always downward

    if system_type == "cantilever_left":
        supports = [Support(x=0.0, support_type=SupportType.FIXED, label="E")]
        if add_horizontal:
            title = f"Kragträger, P = ({force_x:g} / {load_value:g}) kN"
        else:
            title = f"Kragträger, freies Ende rechts, P = {load_value:g} kN"
    else:
        supports = [
            Support(x=0.0, support_type=SupportType.PIN, label="A"),
            Support(x=length, support_type=SupportType.ROLLER, label="B"),
        ]
        if add_horizontal:
            title = f"Einfeldträger, P = ({force_x:g} / {load_value:g}) kN"
        else:
            title = f"Einfeldträger, P = {load_value:g} kN"

    beam = Beam(
        length=length,
        supports=supports,
        point_loads=[PointLoad(x=load_x, force_y=force_y, force_x=force_x, label="P")],
        title=title,
    )

    # Weight N more heavily when horizontal force present; otherwise balance Q and M
    if add_horizontal:
        available_kinds = [DiagramKind.NORMAL, DiagramKind.NORMAL, DiagramKind.SHEAR, DiagramKind.MOMENT]
    else:
        available_kinds = [DiagramKind.SHEAR, DiagramKind.SHEAR, DiagramKind.MOMENT, DiagramKind.MOMENT, DiagramKind.NORMAL]
    diagram_kind = rng.choice(available_kinds)

    correct_shape = _correct_shape(beam, diagram_kind, convention, system_type)
    wrong_shapes = _wrong_shapes(correct_shape, diagram_kind, rng)
    shapes = [correct_shape, *wrong_shapes[:2]]
    rng.shuffle(shapes)

    options = [
        DiagramOption(
            option_id=chr(ord("A") + index),
            label=chr(ord("A") + index),
            shape=shape,
            is_correct=shape == correct_shape,
        )
        for index, shape in enumerate(shapes)
    ]
    correct_id = next(option.option_id for option in options if option.is_correct)

    return DiagramChallenge(
        title=_title_for_kind(diagram_kind),
        level=level,
        challenge_type="beam",
        beam=beam,
        diagram_kind=diagram_kind,
        system_type=system_type,
        options=options,
        correct_option_id=correct_id,
        explanation=_explanation(diagram_kind, system_type, force_x=force_x),
    )


def generate_truss_challenge(
    convention: SignConvention,
    level: int = 11,
    difficulty: int = 1,
    seed: int | None = None,
) -> DiagramChallenge:
    rng = random.Random(seed)
    truss, model = _truss_template(difficulty, rng)
    result = solve_truss(model)
    signs = tuple(_force_sign(result.bar_forces[bar.bar_id], convention) for bar in truss.bars)
    shapes = [f"truss:{_encode_signs(signs)}"]
    shapes.extend(f"truss:{_encode_signs(item)}" for item in _wrong_sign_patterns(signs))
    shapes = shapes[:3]
    rng.shuffle(shapes)

    options = [
        DiagramOption(
            option_id=chr(ord("A") + index),
            label=chr(ord("A") + index),
            shape=shape,
            is_correct=shape == f"truss:{_encode_signs(signs)}",
        )
        for index, shape in enumerate(shapes)
    ]
    correct_id = next(option.option_id for option in options if option.is_correct)

    return DiagramChallenge(
        title="Wähle den richtigen Normalkraftverlauf im Fachwerk",
        level=level,
        challenge_type="truss",
        beam=None,
        diagram_kind=DiagramKind.NORMAL,
        system_type="truss",
        options=options,
        correct_option_id=correct_id,
        explanation=(
            "Im idealen Fachwerk tragen Stäbe nur Normalkraft. "
            "Plus bedeutet Zug, Minus bedeutet Druck."
        ),
        truss=truss,
    )


def _truss_template(
    difficulty: int,
    rng: random.Random,
) -> tuple[TrussVisual, TrussModel]:
    if difficulty <= 1:
        load_value = rng.choice([8.0, 10.0, 12.0])
        joints = [
            TrussJoint(1, 0.0, 0.0),
            TrussJoint(2, 2.0, -1.5),
            TrussJoint(3, 4.0, 0.0),
        ]
        bars = [
            TrussBar(1, 1, 2),
            TrussBar(2, 2, 3),
            TrussBar(3, 1, 3),
        ]
        supports = [JointSupport(1, "pin"), JointSupport(3, "roller")]
        loads = [JointLoad(2, 0.0, load_value)]
    else:
        load_value = rng.choice([8.0, 10.0, 12.0, 14.0])
        side = rng.choice([2, 4])
        joints = [
            TrussJoint(1, 0.0, 0.0),
            TrussJoint(2, 2.0, -1.5),
            TrussJoint(3, 4.0, 0.0),
            TrussJoint(4, 6.0, -1.5),
            TrussJoint(5, 8.0, 0.0),
        ]
        bars = [
            TrussBar(1, 1, 2),
            TrussBar(2, 2, 3),
            TrussBar(3, 1, 3),
            TrussBar(4, 3, 4),
            TrussBar(5, 4, 5),
            TrussBar(6, 3, 5),
            TrussBar(7, 2, 4),
        ]
        supports = [JointSupport(1, "pin"), JointSupport(5, "roller")]
        loads = [JointLoad(side, 0.0, load_value)]

    truss = TrussVisual(joints=joints, bars=bars, loads=loads, supports=supports)
    model = TrussModel(joints=joints, bars=bars, loads=loads, supports=supports)
    return truss, model


def _frame_template(
    difficulty: int,
    rng: random.Random,
) -> tuple[FrameVisual, dict[DiagramKind, tuple[int, ...]]]:
    template = rng.choice(["elbow", "portal", "zigzag"] if difficulty > 1 else ["elbow", "portal"])

    if template == "elbow":
        joints = [
            TrussJoint(1, 0.0, 0.0),
            TrussJoint(2, 2.0, 0.0),
            TrussJoint(3, 2.0, -1.5),
            TrussJoint(4, 0.8, -1.5),
        ]
        bars = [
            TrussBar(1, 1, 2),
            TrussBar(2, 2, 3),
            TrussBar(3, 3, 4),
        ]
        supports = [JointSupport(1, "fixed")]
        loads = [JointLoad(4, 0.0, 10.0)]
        distributed_bars: list[int] = []
        signs = {
            DiagramKind.NORMAL: (0, -1, 0),
            DiagramKind.SHEAR: (1, 0, 1),
            DiagramKind.MOMENT: (1, 1, 1),
        }
    elif template == "portal":
        joints = [
            TrussJoint(1, 0.0, 0.0),
            TrussJoint(2, 1.7, -1.7),
            TrussJoint(3, 3.6, -1.7),
            TrussJoint(4, 3.6, 0.0),
        ]
        bars = [
            TrussBar(1, 1, 2),
            TrussBar(2, 2, 3),
            TrussBar(3, 3, 4),
        ]
        supports = [JointSupport(1, "fixed"), JointSupport(4, "pin")]
        loads = [JointLoad(3, 0.0, 10.0)]
        distributed_bars = [2]
        signs = {
            DiagramKind.NORMAL: (1, 0, -1),
            DiagramKind.SHEAR: (1, 1, -1),
            DiagramKind.MOMENT: (1, -1, 1),
        }
    else:
        joints = [
            TrussJoint(1, 0.0, 0.0),
            TrussJoint(2, 1.4, -1.4),
            TrussJoint(3, 2.8, 0.0),
            TrussJoint(4, 4.2, -1.4),
            TrussJoint(5, 5.6, 0.0),
        ]
        bars = [
            TrussBar(1, 1, 2),
            TrussBar(2, 2, 3),
            TrussBar(3, 3, 4),
            TrussBar(4, 4, 5),
        ]
        supports = [JointSupport(1, "roller"), JointSupport(5, "fixed")]
        loads = [JointLoad(1, 0.0, 10.0)]
        distributed_bars = [1]
        signs = {
            DiagramKind.NORMAL: (-1, 1, -1, 1),
            DiagramKind.SHEAR: (1, -1, 1, -1),
            DiagramKind.MOMENT: (-1, -1, 1, 1),
        }

    return (
        FrameVisual(
            joints=joints,
            bars=bars,
            loads=loads,
            supports=supports,
            distributed_bars=distributed_bars,
        ),
        signs,
    )


def _apply_frame_convention(
    signs: tuple[int, ...],
    diagram_kind: DiagramKind,
    convention: SignConvention,
) -> tuple[int, ...]:
    if diagram_kind is DiagramKind.NORMAL:
        factor = 1 if convention.convert_axial(1.0) > 0 else -1
    elif diagram_kind is DiagramKind.SHEAR:
        factor = 1 if convention.convert_shear(1.0) > 0 else -1
    else:
        factor = 1 if convention.convert_moment(1.0) > 0 else -1
    return tuple(sign * factor for sign in signs)


def _force_sign(force: float, convention: SignConvention) -> int:
    converted = convention.convert_axial(force)
    if abs(converted) <= 1e-6:
        return 0
    return 1 if converted > 0 else -1


def _encode_signs(signs: tuple[int, ...]) -> str:
    return "".join("p" if sign > 0 else "m" if sign < 0 else "z" for sign in signs)


def _decode_signs(encoded: str) -> tuple[int, ...]:
    return tuple(1 if char == "p" else -1 if char == "m" else 0 for char in encoded)


def _wrong_sign_patterns(signs: tuple[int, ...]) -> list[tuple[int, ...]]:
    patterns: list[tuple[int, ...]] = []
    for index, sign in enumerate(signs):
        if sign == 0:
            replacement = 1
        else:
            replacement = -sign
        candidate = list(signs)
        candidate[index] = replacement
        patterns.append(tuple(candidate))

    if len(signs) >= 2:
        candidate = list(signs)
        candidate[0] = -candidate[0] if candidate[0] != 0 else 1
        candidate[-1] = -candidate[-1] if candidate[-1] != 0 else -1
        patterns.append(tuple(candidate))

    unique: list[tuple[int, ...]] = []
    for pattern in patterns:
        if pattern != signs and pattern not in unique:
            unique.append(pattern)
    return unique


_FLIP_PAIRS: dict[str, str] = {
    "shear_positive_then_negative": "shear_negative_then_positive",
    "shear_negative_then_positive": "shear_positive_then_negative",
    "shear_positive_then_zero":     "shear_negative_then_zero",
    "shear_negative_then_zero":     "shear_positive_then_zero",
    "constant_positive":            "constant_negative",
    "constant_negative":            "constant_positive",
    "moment_triangle_positive":     "moment_triangle_negative",
    "moment_triangle_negative":     "moment_triangle_positive",
    "moment_peak_left_positive":    "moment_peak_left_negative",
    "moment_peak_left_negative":    "moment_peak_left_positive",
    "moment_peak_right_positive":   "moment_peak_right_negative",
    "moment_peak_right_negative":   "moment_peak_right_positive",
    "moment_cantilever_positive":   "moment_cantilever_negative",
    "moment_cantilever_negative":   "moment_cantilever_positive",
    "n_left_positive":              "n_left_negative",
    "n_left_negative":              "n_left_positive",
    "shear_linear_pos_to_neg":      "shear_linear_neg_to_pos",
    "shear_linear_neg_to_pos":      "shear_linear_pos_to_neg",
    "moment_parabola_positive":     "moment_parabola_negative",
    "moment_parabola_negative":     "moment_parabola_positive",
}


def _generate_distributed_beam_challenge(
    convention: SignConvention,
    level: int,
    rng: random.Random,
) -> DiagramChallenge:
    length = round(rng.uniform(4.0, 8.0) * 2) / 2
    q_value = float(rng.choice([4.0, 5.0, 6.0, 8.0, 10.0]))  # kN/m, downward
    supports = [
        Support(x=0.0, support_type=SupportType.PIN, label="A"),
        Support(x=length, support_type=SupportType.ROLLER, label="B"),
    ]
    distributed = DistributedLoad(x_start=0.0, x_end=length, q=-q_value, label="q")
    beam = Beam(
        length=length,
        supports=supports,
        point_loads=[],
        distributed_loads=[distributed],
        title=f"Einfeldträger mit Streckenlast q = {q_value:g} kN/m",
    )

    diagram_kind = rng.choice([DiagramKind.SHEAR, DiagramKind.MOMENT])

    if diagram_kind is DiagramKind.SHEAR:
        # Q(0) = +qL/2 (in base convention), Q(L) = -qL/2  → linear.
        left_positive = convention.convert_shear(q_value * length / 2) > 0
        correct_shape = "shear_linear_pos_to_neg" if left_positive else "shear_linear_neg_to_pos"
    else:
        # M_max = q L^2 / 8 at midspan, sagging.
        moment_sign = 1 if convention.convert_moment(1.0) > 0 else -1
        correct_shape = "moment_parabola_positive" if moment_sign > 0 else "moment_parabola_negative"

    wrong_shapes = _wrong_shapes(correct_shape, diagram_kind, rng)
    shapes = [correct_shape, *wrong_shapes[:2]]
    rng.shuffle(shapes)

    options = [
        DiagramOption(
            option_id=chr(ord("A") + index),
            label=chr(ord("A") + index),
            shape=shape,
            is_correct=shape == correct_shape,
        )
        for index, shape in enumerate(shapes)
    ]
    correct_id = next(option.option_id for option in options if option.is_correct)

    explanation = (
        "Eine konstante Streckenlast erzeugt einen linearen Querkraftverlauf "
        "(Q springt nicht, sondern fällt/steigt gleichmäßig)."
        if diagram_kind is DiagramKind.SHEAR
        else "Eine konstante Streckenlast erzeugt einen parabolischen Momentenverlauf "
             "mit M_max = q·L²/8 in der Mitte des Einfeldträgers."
    )

    return DiagramChallenge(
        title=_title_for_kind(diagram_kind),
        level=level,
        challenge_type="beam",
        beam=beam,
        diagram_kind=diagram_kind,
        system_type="pin_roller",
        options=options,
        correct_option_id=correct_id,
        explanation=explanation,
    )


def _correct_shape(
    beam: Beam,
    diagram_kind: DiagramKind,
    convention: SignConvention,
    system_type: str,
) -> str:
    load = beam.point_loads[0]
    load_x = load.x
    length = beam.length
    force_x = getattr(load, "force_x", 0.0)

    if diagram_kind is DiagramKind.NORMAL:
        if abs(force_x) < 1e-9:
            return "zero"
        # Axial force: in both pin-roller and cantilever the horizontal reaction
        # is at the LEFT support.  N = force_x from the support to the load
        # application point, N = 0 beyond the load – regardless of system type.
        converted = convention.convert_axial(force_x)
        return "n_left_positive" if converted > 0 else "n_left_negative"

    if diagram_kind is DiagramKind.SHEAR:
        if system_type == "cantilever_left":
            fixed_reaction = -load.force_y
            left_positive = convention.convert_shear(fixed_reaction) > 0
            return "shear_positive_then_zero" if left_positive else "shear_negative_then_zero"

        reactions = solve_support_reactions(beam)
        left_positive = convention.convert_shear(reactions.ay) > 0
        right_positive = convention.convert_shear(reactions.ay + load.force_y) > 0
        if left_positive and not right_positive:
            return "shear_positive_then_negative"
        if not left_positive and right_positive:
            return "shear_negative_then_positive"
        return "constant_positive" if left_positive else "constant_negative"

    moment_sign = 1 if convention.convert_moment(1.0) > 0 else -1
    if system_type == "cantilever_left":
        cantilever_moment_sign = 1 if convention.convert_moment(-1.0) > 0 else -1
        return "moment_cantilever_positive" if cantilever_moment_sign > 0 else "moment_cantilever_negative"

    if abs(load_x - length / 2) < 1e-9:
        return "moment_triangle_positive" if moment_sign > 0 else "moment_triangle_negative"
    if load_x < length / 2:
        return "moment_peak_left_positive" if moment_sign > 0 else "moment_peak_left_negative"
    return "moment_peak_right_positive" if moment_sign > 0 else "moment_peak_right_negative"


def _wrong_shapes(
    correct_shape: str,
    diagram_kind: DiagramKind,
    rng: random.Random | None = None,
) -> list[str]:
    flipped = _FLIP_PAIRS.get(correct_shape)

    if diagram_kind is DiagramKind.NORMAL:
        pool = ["constant_positive", "constant_negative", "n_left_positive", "n_left_negative", "zero"]
    elif diagram_kind is DiagramKind.SHEAR:
        pool = [
            "shear_positive_then_negative", "shear_negative_then_positive",
            "shear_positive_then_zero", "shear_negative_then_zero",
            "shear_linear_pos_to_neg", "shear_linear_neg_to_pos",
            "constant_positive", "constant_negative", "zero",
        ]
    else:
        pool = [
            "moment_triangle_positive", "moment_triangle_negative",
            "moment_peak_left_positive", "moment_peak_left_negative",
            "moment_peak_right_positive", "moment_peak_right_negative",
            "moment_cantilever_positive", "moment_cantilever_negative",
            "moment_parabola_positive", "moment_parabola_negative",
            "constant_positive",
        ]

    others = [s for s in pool if s != correct_shape and s != flipped]
    if rng is not None:
        rng.shuffle(others)

    # Include the sign-flipped answer only ~50% of the time. Otherwise the
    # answer becomes too predictable ("the right one is just the mirror of
    # one of the wrongs"). When omitted, flipped is treated like any other
    # pool entry.
    force_flipped = rng is None or rng.random() < 0.5
    if flipped and flipped != correct_shape and force_flipped:
        return [flipped, *others]

    candidates = list(others)
    if flipped and flipped != correct_shape and not force_flipped:
        candidates.append(flipped)
        if rng is not None:
            rng.shuffle(candidates)
    return candidates


def _title_for_kind(diagram_kind: DiagramKind) -> str:
    if diagram_kind is DiagramKind.NORMAL:
        return "Wähle den richtigen Normalkraftverlauf"
    if diagram_kind is DiagramKind.SHEAR:
        return "Wähle den richtigen Querkraftverlauf"
    return "Wähle den richtigen Momentenverlauf"


def _explanation(diagram_kind: DiagramKind, system_type: str, force_x: float = 0.0) -> str:
    if diagram_kind is DiagramKind.NORMAL:
        if abs(force_x) < 1e-9:
            return "Es gibt hier keine horizontale Last. Deshalb ist der Normalkraftverlauf N überall null."
        if system_type == "cantilever_left":
            return "Die horizontale Lastkomponente erzeugt eine konstante Normalkraft N im gesamten Träger."
        return "Die horizontale Lastkomponente wird vom Festlager aufgenommen. Zwischen Festlager und Lastangriffspunkt wirkt eine konstante Normalkraft N."

    if diagram_kind is DiagramKind.SHEAR:
        if system_type == "cantilever_left":
            return "Beim Kragträger trägt die Einspannung die Querkraft bis zur Punktlast. Rechts der Last bis zum freien Ende ist Q null."
        return "Bei einer Punktlast springt der Querkraftverlauf. Zwischen Einzelkräften bleibt Q konstant."

    if system_type == "cantilever_left":
        return "Beim Kragträger ist das Moment am freien Ende null und wächst linear zur Einspannung hin."
    return "Bei einer Punktlast verläuft das Moment linear; der Knick liegt unter der Punktlast."
