"""Regressionstests für die Vorzeichenkonvention (ETH Mechanik II, Prof. Mohr).

Kurs-Konvention (siehe docs/vorzeichen-audit.md, belegt durch FS 2025 Frage D3):
  - Koordinaten: x nach rechts, y nach unten, z in die Zeichenebene (z⊗).
  - N positiv = Zug.
  - Q positiv = am linken Schnittufer nach oben (äquivalent: +y am positiven
    Schnittufer).
  - M_z positiv = Moment um die +z-Achse. Für einen durchhängenden Balken
    (Last nach unten) ist M_z NEGATIV — d.h. effektiv "hogging positiv".
    Das entspricht uni.json (moment_positive = "hogging").

Der Frame-FEM-Solver in server.py liefert M intern in Element-Konvention
(M+ = Zug auf der +lokal-y-Seite, "sagging+"). Das Frontend rechnet um:
M_kurs = -M_fem. Diese Tests pinnen die FEM-Basiswerte fest, damit die
Frontend-Umrechnung stabil bleibt.
"""

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from server import _solve_frame_builder  # noqa: E402

from schnittkraft_trainer.game.console_game import load_convention  # noqa: E402
from schnittkraft_trainer.game.diagram_challenges import _correct_shape  # noqa: E402
from schnittkraft_trainer.mechanics.truss_solver import (  # noqa: E402
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)
from schnittkraft_trainer.model.load import PointLoad  # noqa: E402
from schnittkraft_trainer.model.structure import Beam  # noqa: E402
from schnittkraft_trainer.model.support import Support, SupportType  # noqa: E402
from schnittkraft_trainer.game.diagram_challenges import DiagramKind  # noqa: E402

CONV_DIR = REPO_ROOT / "schnittkraft_trainer" / "data" / "sign_conventions"


class TestUniConvention(unittest.TestCase):
    """uni.json muss die Kurs-Konvention abbilden (Zug+/Q-oben+/hogging+)."""

    def test_uni_json_is_course_convention(self) -> None:
        conv = load_convention(CONV_DIR / "uni.json")
        self.assertEqual(conv.axial_positive.value, "tension")
        self.assertEqual(conv.shear_positive_on_left_cut.value, "up")
        self.assertEqual(conv.moment_positive.value, "hogging")


class TestFrameFemBaseConvention(unittest.TestCase):
    """Pinnt die FEM-Element-Konvention fest (Frontend rechnet M_kurs = -M_fem)."""

    def test_simply_supported_beam_with_udl(self) -> None:
        # Einfeldträger L=4, q=+1 (nach unten, y↓-Koordinaten), Pin + Roller.
        joints = [{"joint_id": 1, "x": 0, "y": 0}, {"joint_id": 2, "x": 4, "y": 0}]
        bars = [{"bar_id": 1, "start_id": 1, "end_id": 2}]
        sups = [
            {"joint_id": 1, "support_type": "pin"},
            {"joint_id": 2, "support_type": "roller"},
        ]
        bf, reactions = _solve_frame_builder(joints, bars, sups, [], set(),
                                             [{"bar_id": 1, "q": 1.0}])
        f = bf[1]
        # Q wie Kurs-Konvention: links +qL/2, rechts -qL/2.
        self.assertAlmostEqual(f["Q_start"], 2.0, places=6)
        self.assertAlmostEqual(f["Q_end"], -2.0, places=6)
        # FEM-M ist sagging+: Feldmitte +qL²/8 = +2  →  Kurs: M_z = -2.
        m_mid_fem = f["M_start"] + f["Q_start"] * 2.0 - 1.0 * 2.0**2 / 2
        self.assertAlmostEqual(m_mid_fem, 2.0, places=6)
        self.assertAlmostEqual(f["M_start"], 0.0, places=6)
        self.assertAlmostEqual(f["M_end"], 0.0, places=6)
        # Reaktionen in y↓-Koordinaten: nach oben = negativ.
        self.assertAlmostEqual(reactions["ry:1"], -2.0, places=6)
        self.assertAlmostEqual(reactions["ry:2"], -2.0, places=6)

    def test_cantilever_with_tip_load(self) -> None:
        # Kragträger: Einspannung links, L=4, Punktlast fy=+5 (nach unten) am Ende.
        joints = [{"joint_id": 1, "x": 0, "y": 0}, {"joint_id": 2, "x": 4, "y": 0}]
        bars = [{"bar_id": 1, "start_id": 1, "end_id": 2}]
        sups = [{"joint_id": 1, "support_type": "fixed"}]
        bf, reactions = _solve_frame_builder(
            joints, bars, sups, [{"joint_id": 2, "fx": 0, "fy": 5}], set(), [])
        f = bf[1]
        self.assertAlmostEqual(f["Q_start"], 5.0, places=6)
        self.assertAlmostEqual(f["Q_end"], 5.0, places=6)
        # FEM-M an der Einspannung: -PL = -20 (sagging-Konvention, Zug oben)
        # → Kurs: M_z = +20 (hogging+).
        self.assertAlmostEqual(f["M_start"], -20.0, places=6)
        self.assertAlmostEqual(f["M_end"], 0.0, places=6)
        # Reaktionen: Kraft nach oben (-5 in y↓), Reaktionsmoment -20.
        self.assertAlmostEqual(reactions["ry:1"], -5.0, places=6)
        self.assertAlmostEqual(reactions["mz:1"], -20.0, places=6)


class TestBarDirectionDependence(unittest.TestCase):
    """Das FEM-Ergebnis ist bewusst richtungsabhängig (lokales System folgt
    der Stabdefinition start→end). Das Frontend kanonisiert deshalb jede
    Stabrichtung (DrawUtils.isCanonicalDir: lokal-x mit +globaler
    x-Komponente, vertikal nach unten). Dieser Test pinnt das rohe
    Backend-Verhalten fest, damit die Frontend-Kanonisierung stabil bleibt."""

    def test_reversed_bar_flips_shear_and_moment_ends(self) -> None:
        joints = [{"joint_id": 1, "x": 0, "y": 0}, {"joint_id": 2, "x": 4, "y": 0}]
        sups = [{"joint_id": 1, "support_type": "fixed"}]
        loads = [{"joint_id": 2, "fx": 0, "fy": 5}]
        fwd, _ = _solve_frame_builder(
            joints, [{"bar_id": 1, "start_id": 1, "end_id": 2}], sups, loads, set(), [])
        rev, _ = _solve_frame_builder(
            joints, [{"bar_id": 1, "start_id": 2, "end_id": 1}], sups, loads, set(), [])
        # Kanonisch (1→2): Q konstant +5, M an der Einspannung (start) −20.
        self.assertAlmostEqual(fwd[1]["Q_start"], 5.0, places=6)
        self.assertAlmostEqual(fwd[1]["M_start"], -20.0, places=6)
        # Rückwärts (2→1): Enden getauscht, lokale y-Achse gedreht →
        # M wandert mit Vorzeichenwechsel ans andere Ende.
        self.assertAlmostEqual(rev[1]["M_start"], 0.0, places=6)
        self.assertAlmostEqual(rev[1]["M_end"], 20.0, places=6)

    def test_inclined_bar_udl_acts_in_local_y(self) -> None:
        # 45°-Stab mit q=1: Streckenlast wirkt in lokal-y (senkrecht zum Stab),
        # nicht global-vertikal. N ist deshalb konstant ≠ 0.
        joints = [{"joint_id": 1, "x": 0, "y": 0}, {"joint_id": 2, "x": 4, "y": -4}]
        bars = [{"bar_id": 1, "start_id": 1, "end_id": 2}]
        sups = [{"joint_id": 1, "support_type": "pin"},
                {"joint_id": 2, "support_type": "roller"}]
        bf, _ = _solve_frame_builder(joints, bars, sups, [], set(),
                                     [{"bar_id": 1, "q": 1.0}])
        L = 32 ** 0.5
        self.assertAlmostEqual(bf[1]["Q_start"], L / 2, places=3)
        self.assertAlmostEqual(bf[1]["Q_end"], -L / 2, places=3)
        self.assertAlmostEqual(bf[1]["N_start"], bf[1]["N_end"], places=6)
        self.assertGreater(abs(bf[1]["N_start"]), 1.0)


class TestTrussSolverSigns(unittest.TestCase):
    def test_three_bar_truss_tension_compression(self) -> None:
        # Dreieck: Apex (Knoten 2) OBEN (y=-1.5), Last nach unten (fy=+10).
        model = TrussModel(
            joints=[TrussJoint(1, 0, 0), TrussJoint(2, 2, -1.5), TrussJoint(3, 4, 0)],
            bars=[TrussBar(1, 1, 2), TrussBar(2, 2, 3), TrussBar(3, 1, 3)],
            loads=[JointLoad(2, 0.0, 10.0)],
            supports=[JointSupport(1, "pin"), JointSupport(3, "roller")],
        )
        result = solve_truss(model)
        # Diagonalen gedrückt, Untergurt gezogen.
        self.assertLess(result.bar_forces[1], 0)
        self.assertLess(result.bar_forces[2], 0)
        self.assertGreater(result.bar_forces[3], 0)
        self.assertAlmostEqual(result.bar_forces[1], -25.0 / 3, places=3)
        self.assertAlmostEqual(result.bar_forces[3], 20.0 / 3, places=3)


class TestBeamQuizShapes(unittest.TestCase):
    """Quiz-Formen (The Basics / Speed Run) in uni-Konvention."""

    def setUp(self) -> None:
        self.conv = load_convention(CONV_DIR / "uni.json")

    def test_midspan_load_moment_is_negative_shape(self) -> None:
        # Durchhängender Einfeldträger: M_z negativ (hogging+ Konvention).
        beam = Beam(
            length=4.0,
            supports=[
                Support(x=0.0, support_type=SupportType.PIN, label="A"),
                Support(x=4.0, support_type=SupportType.ROLLER, label="B"),
            ],
            point_loads=[PointLoad(x=2.0, force_y=-10.0, force_x=0.0, label="P")],
            title="test",
        )
        shape = _correct_shape(beam, DiagramKind.MOMENT, self.conv, "pin_roller")
        self.assertEqual(shape, "moment_triangle_negative")

    def test_midspan_load_shear_starts_positive(self) -> None:
        beam = Beam(
            length=4.0,
            supports=[
                Support(x=0.0, support_type=SupportType.PIN, label="A"),
                Support(x=4.0, support_type=SupportType.ROLLER, label="B"),
            ],
            point_loads=[PointLoad(x=2.0, force_y=-10.0, force_x=0.0, label="P")],
            title="test",
        )
        shape = _correct_shape(beam, DiagramKind.SHEAR, self.conv, "pin_roller")
        self.assertEqual(shape, "shear_positive_then_negative")

    def test_cantilever_moment_is_positive_shape(self) -> None:
        # Kragträger, Last nach unten: Zug oben an der Einspannung → M_z positiv.
        beam = Beam(
            length=4.0,
            supports=[Support(x=0.0, support_type=SupportType.FIXED, label="E")],
            point_loads=[PointLoad(x=2.0, force_y=-10.0, force_x=0.0, label="P")],
            title="test",
        )
        shape = _correct_shape(beam, DiagramKind.MOMENT, self.conv, "cantilever_left")
        self.assertEqual(shape, "moment_cantilever_positive")


if __name__ == "__main__":
    unittest.main()
