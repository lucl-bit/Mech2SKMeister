from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class TrussJoint:
    joint_id: int
    x: float
    y: float


@dataclass(frozen=True)
class TrussBar:
    bar_id: int
    start_id: int
    end_id: int


@dataclass(frozen=True)
class JointLoad:
    joint_id: int
    fx: float
    fy: float


@dataclass(frozen=True)
class JointSupport:
    joint_id: int
    support_type: str


@dataclass(frozen=True)
class TrussModel:
    joints: list[TrussJoint]
    bars: list[TrussBar]
    loads: list[JointLoad]
    supports: list[JointSupport]


@dataclass(frozen=True)
class TrussSolveResult:
    bar_forces: dict[int, float]
    reactions: dict[str, float]


def solve_truss(model: TrussModel) -> TrussSolveResult:
    """Solve a statically determinate pin-jointed truss.

    Coordinates follow the app convention:
    - x positive to the right
    - y positive downward

    Member force sign:
    - positive = tension
    - negative = compression
    """

    _validate_model(model)
    joints = sorted(model.joints, key=lambda joint: joint.joint_id)
    joint_index = {joint.joint_id: index for index, joint in enumerate(joints)}
    loads_by_joint = _sum_loads_by_joint(model.loads)

    unknown_names: list[str] = []
    for bar in model.bars:
        unknown_names.append(f"bar:{bar.bar_id}")
    for support in model.supports:
        if support.support_type in {"pin", "pin_wall", "fixed"}:
            unknown_names.append(f"rx:{support.joint_id}")
            unknown_names.append(f"ry:{support.joint_id}")
        elif support.support_type in {"roller", "roller_y"}:
            unknown_names.append(f"ry:{support.joint_id}")
        elif support.support_type == "roller_x":
            unknown_names.append(f"rx:{support.joint_id}")
        else:
            raise ValueError(f"Unsupported support type: {support.support_type}")

    equation_count = 2 * len(joints)
    if len(unknown_names) != equation_count:
        raise ValueError(
            "Fachwerk ist nicht statisch bestimmt nach m + r = 2j "
            f"({len(unknown_names)} Unbekannte, {equation_count} Gleichungen)."
        )

    matrix = [[0.0 for _ in unknown_names] for _ in range(equation_count)]
    rhs = [0.0 for _ in range(equation_count)]
    unknown_index = {name: index for index, name in enumerate(unknown_names)}

    for joint in joints:
        row_x = 2 * joint_index[joint.joint_id]
        row_y = row_x + 1
        load = loads_by_joint.get(joint.joint_id, (0.0, 0.0))
        rhs[row_x] = -load[0]
        rhs[row_y] = -load[1]

    joints_by_id = {joint.joint_id: joint for joint in joints}
    for bar in model.bars:
        start = joints_by_id[bar.start_id]
        end = joints_by_id[bar.end_id]
        dx = end.x - start.x
        dy = end.y - start.y
        length = math.hypot(dx, dy)
        if length <= 1e-9:
            raise ValueError(f"Stab {bar.bar_id} hat Länge 0.")

        ux = dx / length
        uy = dy / length
        col = unknown_index[f"bar:{bar.bar_id}"]

        start_row_x = 2 * joint_index[start.joint_id]
        start_row_y = start_row_x + 1
        end_row_x = 2 * joint_index[end.joint_id]
        end_row_y = end_row_x + 1

        matrix[start_row_x][col] += ux
        matrix[start_row_y][col] += uy
        matrix[end_row_x][col] -= ux
        matrix[end_row_y][col] -= uy

    for support in model.supports:
        row_x = 2 * joint_index[support.joint_id]
        row_y = row_x + 1
        if support.support_type in {"pin", "pin_wall", "fixed"}:
            matrix[row_x][unknown_index[f"rx:{support.joint_id}"]] = 1.0
            matrix[row_y][unknown_index[f"ry:{support.joint_id}"]] = 1.0
        elif support.support_type in {"roller", "roller_y"}:
            matrix[row_y][unknown_index[f"ry:{support.joint_id}"]] = 1.0
        elif support.support_type == "roller_x":
            matrix[row_x][unknown_index[f"rx:{support.joint_id}"]] = 1.0

    solution = _solve_linear_system(matrix, rhs)
    values = dict(zip(unknown_names, solution))

    return TrussSolveResult(
        bar_forces={
            bar.bar_id: values[f"bar:{bar.bar_id}"]
            for bar in model.bars
        },
        reactions={
            name: value
            for name, value in values.items()
            if name.startswith("rx:") or name.startswith("ry:")
        },
    )


def _sum_loads_by_joint(loads: list[JointLoad]) -> dict[int, tuple[float, float]]:
    result: dict[int, tuple[float, float]] = {}
    for load in loads:
        fx, fy = result.get(load.joint_id, (0.0, 0.0))
        result[load.joint_id] = (fx + load.fx, fy + load.fy)
    return result


def _validate_model(model: TrussModel) -> None:
    joint_ids = {joint.joint_id for joint in model.joints}
    if len(joint_ids) != len(model.joints):
        raise ValueError("Knoten-IDs müssen eindeutig sein.")
    if not model.joints:
        raise ValueError("Fachwerk braucht mindestens einen Knoten.")

    for bar in model.bars:
        if bar.start_id not in joint_ids or bar.end_id not in joint_ids:
            raise ValueError(f"Stab {bar.bar_id} referenziert unbekannte Knoten.")
        if bar.start_id == bar.end_id:
            raise ValueError(f"Stab {bar.bar_id} verbindet einen Knoten mit sich selbst.")

    for support in model.supports:
        if support.joint_id not in joint_ids:
            raise ValueError("Lager referenziert unbekannten Knoten.")

    for load in model.loads:
        if load.joint_id not in joint_ids:
            raise ValueError("Last referenziert unbekannten Knoten.")


def _solve_linear_system(matrix: list[list[float]], rhs: list[float]) -> list[float]:
    size = len(rhs)
    augmented = [row[:] + [rhs[index]] for index, row in enumerate(matrix)]

    for pivot_index in range(size):
        pivot_row = max(
            range(pivot_index, size),
            key=lambda row: abs(augmented[row][pivot_index]),
        )
        if abs(augmented[pivot_row][pivot_index]) <= 1e-10:
            raise ValueError("Gleichungssystem ist singulär. Prüfe Geometrie und Lagerung.")

        augmented[pivot_index], augmented[pivot_row] = (
            augmented[pivot_row],
            augmented[pivot_index],
        )
        pivot = augmented[pivot_index][pivot_index]

        for col in range(pivot_index, size + 1):
            augmented[pivot_index][col] /= pivot

        for row in range(size):
            if row == pivot_index:
                continue
            factor = augmented[row][pivot_index]
            if abs(factor) <= 1e-12:
                continue
            for col in range(pivot_index, size + 1):
                augmented[row][col] -= factor * augmented[pivot_index][col]

    return [augmented[row][size] for row in range(size)]
