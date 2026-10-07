"""Checks that the printability analysis catches what it should.

    .venv/bin/python tests.py      (or `make test`)
"""

import tempfile
from pathlib import Path

import trimesh
from build123d import Align, Box, Cylinder, Pos, Rot, export_stl

from report import analyse_mesh

MIN = (Align.MIN, Align.MIN, Align.MIN)


def regions(shape):
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "s.stl"
        export_stl(shape, path, tolerance=0.01, angular_tolerance=0.1)
        return analyse_mesh(trimesh.load(path))


def test_wall_slot_spans_its_length():
    # A 40 × 2 horizontal slot through a 2.4 mm wall bridges 40 mm, not 2.4
    wall = Box(60, 2.4, 20, align=MIN) - Pos(10, -1, 8) * Box(40, 5, 2, align=MIN)
    r = regions(wall)
    assert len(r) == 1 and abs(r[0]["span"] - 40) < 0.6, r


def test_pocket_roof_spans_its_width():
    block = Box(30, 30, 3, align=MIN) - Pos(15, 15, -1) * Cylinder(5, 2, align=(Align.CENTER, Align.CENTER, Align.MIN))
    r = regions(block)
    assert len(r) == 1 and abs(r[0]["span"] - 10) < 0.6, r


def test_floating_ledge_is_unsupported():
    # A shelf hanging off a post's side has nothing under its outer edge
    part = Box(5, 5, 20, align=MIN) + Pos(5, 0, 15) * Box(20, 5, 2, align=MIN)
    r = regions(part)
    assert r and r[0]["span"] >= 39, r  # anchored on one side only: twice its 20 mm reach


def test_horizontal_cylinder_overhangs():
    part = Box(20, 20, 2, align=MIN) + Pos(10, 0, 10) * Rot(-90, 0, 0) * Cylinder(4, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
    part = part + Pos(8, 0, 2) * Box(4, 20, 5, align=MIN)
    r = regions(part)
    assert any(46.0 < x["angle"] < 89 for x in r), r


def test_45_degree_roof_passes():
    # A peaked window: the roof is exactly 45°, so nothing is flagged
    from build123d import Face, Wire, extrude
    pts = [(10, 0, 5), (20, 0, 5), (20, 0, 10), (15, 0, 15), (10, 0, 10)]
    hole = extrude(Face(Wire.make_polygon([(x, -1, z) for x, _, z in pts], close=True)), amount=5, dir=(0, 1, 0))
    wall = Box(30, 2.4, 25, align=MIN) - hole
    assert regions(wall) == [], regions(wall)


if __name__ == "__main__":
    tests = [v for k, v in dict(globals()).items() if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"{len(tests)} passed")
