"""Hindsight kit enclosure: a parametric build123d model.

    make            # build, export, render and rewrite REPORT.md
    .venv/bin/python kit.py [--no-render]

Every dimension lives in the parameter block below. A value wrapped in
est(...) is published or guessed and not yet checked with calipers. When you
measure one, replace the whole right-hand side with the number, for example

    pi_usb_overhang = 3.1  # measured 2026-10-08

and re-run `make`. REPORT.md lists every est(...) still left.

Coordinates follow SPEC.md: millimetres, origin at the inside front-left
corner of the tray cavity at floor level; X runs left to right seen from the
front, Y runs front to back, Z runs up.
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path


class Est(float):
    """A published or guessed dimension that hasn't been measured yet."""

    note: str

    def __new__(cls, value: float, note: str = ""):
        obj = super().__new__(cls, value)
        obj.note = note
        return obj


def est(value: float, note: str = "") -> Est:
    return Est(value, note)


# ════════════════════════════════════════════════════════════════════════════
#  PARAMETERS
# ════════════════════════════════════════════════════════════════════════════

# ── Build options ───────────────────────────────────────────────────────────
usb_side = "right"  # "right" or "left": the end of the Solo its rear USB-C is on, seen from the front
pi_model = 4        # 4 or 5

# ── Scarlett Solo 4th Gen (not here yet: every value is unmeasured) ─────────
solo_w = est(143.0, "Focusrite: overall width")
solo_d = est(96.0, "Focusrite: overall depth")
solo_h = est(46.5, "Focusrite: overall height")
solo_foot_h = est(2.0, "guess: height of the bottom feet")
solo_usb_x = est(118.0, "guess: rear USB-C centre from the left end, seen from the front")
solo_xlr_z = est(10.0, "guess: XLR plug's lowest point above the deck")
solo_front_low_z = est(10.0, "guess: lowest front knob skirt or jack above the deck")
solo_usb_plug_w = est(12.0, "guess: width of the USB-C plug body going into the Solo")

# ── Raspberry Pi board (official Pi 4 mechanical drawing, RP-008343) ────────
pi_board_l = 85.0
pi_board_w = 56.0
pi_board_t = est(1.5, "spec: about 1.5")
pi_corner_r = 3.0
pi_hole_d = 2.7
pi_hole_pitch_x = 58.0  # along the board's length
pi_hole_pitch_y = 49.0  # across it
pi_hole_inset = 3.5     # from the SD-card end and the power edge

# How far each connector reaches past the board edge
pi_usb_overhang = est(3.0, "drawing: USB-A and Ethernet reach 88.0 on the 85 board")
pi_usbc_overhang = est(1.25, "drawing: USB-C body starts at Y -1.25")
pi_hdmi_overhang = est(1.43, "drawing: micro-HDMI body starts at Y -1.43")
pi_audio_overhang = est(2.5, "drawing: audio barrel reaches Y -2.5 (Pi 4 only)")
pi_sd_protrude = est(2.3, "drawing: an inserted card reaches X -2.27")

# Heights above the board's top face
pi_tallest = est(16.0, "drawing: USB-A stack Z 16.0")
pi_heatsink_top = est(12.0, "guess: an under-10 mm heatsink on the 2.4 mm SoC")
pi_underside = 1.5  # deepest part under the board (the SD socket), for the floor check

# Ports, in the board's own frame: x along the length from the SD-card end,
# y across from the power/HDMI edge. Positions are from the official drawings.
PI_EDGE_PORTS = {  # on the power/HDMI edge: (name, x centre, width, height)
    4: [("USB-C power", 11.2, 8.65, 3.2), ("micro-HDMI 0", 26.0, 7.2, 3.0),
        ("micro-HDMI 1", 39.5, 7.2, 3.0), ("audio", 54.0, 7.0, 6.0)],
    5: [("USB-C power", 11.2, 8.65, 3.2), ("micro-HDMI 0", 25.8, 7.2, 3.0),
        ("micro-HDMI 1", 39.2, 7.2, 3.0)],
}
PI_END_PORTS = {  # on the far short edge: (name, y from, y to, height, body length); USB height is pi_tallest
    4: [("USB 2", 1.65, 16.35, pi_tallest, 17.7), ("USB 3", 19.75, 34.25, pi_tallest, 17.5),
        ("Ethernet", 37.99, 53.51, 13.5, 21.35)],
    5: [("Ethernet", 2.45, 17.95, 13.5, 21.35), ("USB 3", 21.85, 36.35, pi_tallest, 17.5),
        ("USB 2", 39.75, 54.25, pi_tallest, 17.5)],
}

# ── Layout (SPEC.md, Layout table) ──────────────────────────────────────────
fit = 0.6         # clearance per side around the Solo
wall = 2.4        # 6 perimeters at 0.4
floor_t = 2.4
lid_t = 3.0
cav_h = 28.0      # cavity height, floor top to lid underside
standoff_h = 5.0  # Pi boss height
port_gap = 0.5    # Pi port faces stop this far short of the inside wall
min_clearance = 0.5  # REPORT.md flags anything tighter

# ── Heat-set inserts and screws (check against the insert maker's spec) ─────
insert_m25_bore = 3.6
insert_m25_len = 4.0
pi_boss_d = 6.5
insert_m3_bore = 4.0
insert_m3_len = 5.7
lid_boss_d = 7.0
m3_clear_d = 3.4
m3_csk_d = 6.4         # countersink diameter at the lid's top face (head is 6.0)
lid_screw_inset = 6.5  # corner screw centres from the outside edges, clear of the posts
wall_boss_inset = 2.5  # a mid-wall boss's centre from the inside face of its wall

# ── Port openings ───────────────────────────────────────────────────────────
pwr_win_w = 13.0   # USB-C power window, peaked top at 45°
pwr_win_h = 8.0
pwr_plug_w = est(11.0, "guess: official 15 W supply's USB-C plug body width")
pwr_plug_h = est(6.5, "guess: its height")
usb_plug_w = est(16.0, "guess: a USB-A plug body's width, for the notch edges")
usb_plug_h = est(8.0, "guess: a USB-A plug body's height")
usb_low_port_zc = est(4.2, "guess: the lower USB-A port's centre above the board top")
notch_floor_drop = 2.5  # the notch floor sits this far below the board top, for the lower plug's body

# ── Vents ───────────────────────────────────────────────────────────────────
floor_slot_w = 2.0
floor_slot_l = 20.0
floor_slot_pitch = 4.0
side_slot_w = 2.0
side_slot_h = 12.0      # vertical slots with 45° peaked tops, no bridges
side_slot_pitch = 4.0
side_vent_len = 40.0    # length of the slot field along the wall

# ── Feet ────────────────────────────────────────────────────────────────────
foot_recess_d = 10.6    # for ~10 mm adhesive bumpers
foot_recess_t = 1.0
foot_inset = 12.0       # foot centres from the outside edges

# ── Lid top: the Solo pocket ────────────────────────────────────────────────
post_h = 8.0
post_leg = 12.0         # along each face, from the Solo's corner
post_t = wall           # flush with the outside, so the stack is one footprint
post_chamfer = 0.8

# ── Accessory points (for later) ────────────────────────────────────────────
acc_spacing = 60.0
acc_pad_w = 9.0         # pad width along the wall, inside the cavity

# ── Fit test ────────────────────────────────────────────────────────────────
fit_post_slice_h = 2.0
fit_ring_w = 8.0
fit_ring_t = 1.2
fit_plate_margin = 2.0

# ════════════════════════════════════════════════════════════════════════════
#  DERIVED
# ════════════════════════════════════════════════════════════════════════════

assert usb_side in ("right", "left"), usb_side
assert pi_model in (4, 5), pi_model

cav_w = solo_w + 2 * fit
cav_d = solo_d + 2 * fit
out_w = cav_w + 2 * wall
out_d = cav_d + 2 * wall
board_bot_z = standoff_h
board_top_z = standoff_h + pi_board_t
base_h = floor_t + cav_h + lid_t
deck_z = cav_h + lid_t
stack_h = base_h + solo_foot_h + solo_h

edge_ports = PI_EDGE_PORTS[pi_model]
end_ports = PI_END_PORTS[pi_model]
_edge_oh = {"USB-C power": pi_usbc_overhang, "micro-HDMI 0": pi_hdmi_overhang,
            "micro-HDMI 1": pi_hdmi_overhang, "audio": pi_audio_overhang}
edge_overhang = float(max(_edge_oh[name] for name, *_ in edge_ports))

# The Pi's rotation. The real board is chiral: seen from above with the
# SD-card end on the left, the power/HDMI edge is at the FRONT. So:
#   right: USB-A/Ethernet face the rear wall, power/HDMI face the right wall.
#   left:  USB-A/Ethernet face the left wall, power/HDMI face the rear wall.
# (SPEC.md's right-hand layout is the mirror image, which no Pi can sit in.)
if usb_side == "right":
    pi_rot = 90
    pi_tx = cav_w - port_gap - edge_overhang
    pi_ty = cav_d - port_gap - pi_usb_overhang - pi_board_l
    usb_wall, pwr_wall = "rear", "right"
    vent_wall = "left"
else:
    pi_rot = 180
    pi_tx = port_gap + pi_usb_overhang + pi_board_l
    pi_ty = cav_d - port_gap - edge_overhang
    usb_wall, pwr_wall = "left", "rear"
    vent_wall = "right"


def pi_xy(x: float, y: float) -> tuple[float, float]:
    """Board-frame (x, y) to cavity (X, Y)."""
    if pi_rot == 90:
        return pi_tx - y, pi_ty + x
    return pi_tx - x, pi_ty - y


def pi_box(x0, x1, y0, y1, z0, z1, name):
    """A board-frame box (z above the board's top face) as a cavity AABB."""
    (ax, ay), (bx, by) = pi_xy(x0, y0), pi_xy(x1, y1)
    return Box3(name, min(ax, bx), max(ax, bx), min(ay, by), max(ay, by),
                board_top_z + z0, board_top_z + z1)


@dataclass
class Box3:
    name: str
    x0: float
    x1: float
    y0: float
    y1: float
    z0: float
    z1: float


def wall_u(wall_name: str, X: float, Y: float) -> float:
    """Position along a wall: X for front/rear, Y for left/right."""
    return X if wall_name in ("front", "rear") else Y


# Everything the Pi occupies, for clearance checks
pi_keepout: list[Box3] = [
    pi_box(0, pi_board_l, 0, pi_board_w, -pi_board_t, 0, "board"),
    pi_box(-pi_sd_protrude, 12.0, 22.51, 33.51, -pi_board_t - 1.4, -pi_board_t, "SD card"),
    pi_box(21.75, 36.75, 25.0, 40.0, 0, pi_heatsink_top, "heatsink"),
    pi_box(7.1, 57.9, 50.0, 55.0, 0, 8.5, "GPIO header"),
]
for name, xc, w, h in edge_ports:
    depth = 12.5 if name == "audio" else 6.5
    pi_keepout.append(pi_box(xc - w / 2, xc + w / 2, -_edge_oh[name], depth, 0, h, name))
for name, ya, yb, h, length in end_ports:
    pi_keepout.append(pi_box(pi_board_l + pi_usb_overhang - length, pi_board_l + pi_usb_overhang,
                             ya, yb, 0, h, name))

pi_holes = [pi_xy(pi_hole_inset + i * pi_hole_pitch_x, pi_hole_inset + j * pi_hole_pitch_y)
            for i in (0, 1) for j in (0, 1)]
pi_ext = Box3("Pi", min(b.x0 for b in pi_keepout), max(b.x1 for b in pi_keepout),
              min(b.y0 for b in pi_keepout), max(b.y1 for b in pi_keepout),
              min(b.z0 for b in pi_keepout), max(b.z1 for b in pi_keepout))
board_box = pi_keepout[0]

# USB-C power window, centred on the receptacle
_usbc = next(p for p in edge_ports if p[0] == "USB-C power")
pwr_u = wall_u(pwr_wall, *pi_xy(_usbc[1], 0))
pwr_zc = board_top_z + _usbc[3] / 2
pwr_win_z0 = pwr_zc - pwr_win_h / 2

# The notch over the USB-A and Ethernet stacks: the board's span less 0.5 a side
_bu = sorted((wall_u(usb_wall, board_box.x0, board_box.y0), wall_u(usb_wall, board_box.x1, board_box.y1)))
notch_u0, notch_u1 = _bu[0] + 0.5, _bu[1] - 0.5
notch_z0 = board_top_z - notch_floor_drop


def _circle_box_gap(cx, cy, r, b: Box3) -> float:
    dx = max(b.x0 - cx, 0, cx - b.x1)
    dy = max(b.y0 - cy, 0, cy - b.y1)
    return math.hypot(dx, dy) - r


def pi_gap_2d(cx, cy, r) -> float:
    """Plan-view gap from a circle to the nearest Pi part (all of them drop in from above)."""
    return min(_circle_box_gap(cx, cy, r, b) for b in pi_keepout)


# Lid screws: the four corners, less any corner the Pi occupies, plus a boss
# on the rear wall beside the Pi for each corner dropped.
_c = lid_screw_inset - wall
_corners = {"front-left": (_c, _c), "front-right": (cav_w - _c, _c),
            "rear-left": (_c, cav_d - _c), "rear-right": (cav_w - _c, cav_d - _c)}
lid_screws: dict[str, tuple[float, float]] = {}
lid_screws_dropped: list[str] = []
for _name, (_x, _y) in _corners.items():
    if pi_gap_2d(_x, _y, lid_boss_d / 2) >= min_clearance:
        lid_screws[_name] = (_x, _y)
    else:
        lid_screws_dropped.append(_name)
_wy = cav_d - wall_boss_inset
for _name in lid_screws_dropped:
    _side = 2.0 + lid_boss_d / 2
    _x = pi_ext.x0 - _side if _name.endswith("right") else pi_ext.x1 + _side
    lid_screws[f"rear wall, X {_x:.1f}"] = (_x, _wy)
wall_screw_names = [n for n in lid_screws if n.startswith("rear wall")]

# Run the notch on into the corner the Pi took from the lid screws: more room for the outer plug.
if usb_side == "right" and "rear-right" in lid_screws_dropped:
    notch_u1 = cav_w
elif usb_side == "left" and "rear-left" in lid_screws_dropped:
    notch_u1 = cav_d

# usb_side should agree with where the Solo's USB-C actually is
usb_side_agrees = (solo_usb_x > solo_w / 2) == (usb_side == "right")

# Accessory inserts: two per side wall, 60 apart at mid-height, kept only
# where their inside pad clears the Pi, the notch and the windows.
acc_z = cav_h / 2
acc_depth = insert_m3_len + 1.0           # bore depth from the outside face
acc_pad_depth = acc_depth + 1.0 - wall    # how far the pad stands into the cavity
acc_pad_h = 9.0
accessory: list[tuple[str, float]] = []
accessory_dropped: list[tuple[str, float, str]] = []
for _side in ("left", "right"):
    for _u in (cav_d / 2 - acc_spacing / 2, cav_d / 2 + acc_spacing / 2):
        _x0 = 0.0 if _side == "left" else cav_w - acc_pad_depth
        _pad = Box3("pad", _x0, _x0 + acc_pad_depth, _u - acc_pad_w / 2, _u + acc_pad_w / 2, 0, cav_h)
        _why = None
        if min(max(b.x0 - _pad.x1, _pad.x0 - b.x1, b.y0 - _pad.y1, _pad.y0 - b.y1) for b in pi_keepout) < min_clearance:
            _why = "the Pi sits there"
        elif _side == usb_wall and notch_u0 - acc_pad_w / 2 - 1 < _u < notch_u1 + acc_pad_w / 2 + 1:
            _why = "the port notch is there"
        elif _side == pwr_wall and abs(_u - pwr_u) < pwr_win_w / 2 + acc_pad_w / 2 + 1:
            _why = "the power window is there"
        if _why:
            accessory_dropped.append((_side, _u, _why))
        else:
            accessory.append((_side, _u))

feet = [(foot_inset - wall, foot_inset - wall), (cav_w - foot_inset + wall, foot_inset - wall),
        (foot_inset - wall, cav_d - foot_inset + wall), (cav_w - foot_inset + wall, cav_d - foot_inset + wall)]


def _floor_slots() -> list[tuple[float, float]]:
    """Centres of 2 × 20 floor slots (long axis along X) under the board."""
    x0, x1 = board_box.x0 + 3, board_box.x1 - 3
    y0, y1 = board_box.y0 + 3, board_box.y1 - 3
    ncol = int((x1 - x0 + floor_slot_pitch) // (floor_slot_l + floor_slot_pitch))
    span = ncol * floor_slot_l + (ncol - 1) * floor_slot_pitch
    xs = [x0 + (x1 - x0 - span) / 2 + floor_slot_l / 2 + i * (floor_slot_l + floor_slot_pitch) for i in range(ncol)]
    nrow = int((y1 - y0 - floor_slot_w) // floor_slot_pitch) + 1
    ys = [y0 + (y1 - y0 - (nrow - 1) * floor_slot_pitch) / 2 + j * floor_slot_pitch for j in range(nrow)]
    keep = [(hx, hy, pi_boss_d / 2 + 1.5) for hx, hy in pi_holes]
    keep += [(fx, fy, foot_recess_d / 2 + 1.5) for fx, fy in feet]
    keep += [(sx, sy, lid_boss_d / 2 + 1.5) for sx, sy in lid_screws.values()]
    out = []
    for x in xs:
        for y in ys:
            b = Box3("slot", x - floor_slot_l / 2, x + floor_slot_l / 2, y - floor_slot_w / 2, y + floor_slot_w / 2, 0, 0)
            if all(_circle_box_gap(kx, ky, kr, b) > 0 for kx, ky, kr in keep):
                out.append((x, y))
    return out


floor_slots = _floor_slots()
side_slots_u = [cav_d / 2 - side_vent_len / 2 + side_slot_w / 2 + i * side_slot_pitch
                for i in range(int((side_vent_len - side_slot_w) // side_slot_pitch) + 1)]
side_slot_z0 = cav_h / 2 - side_slot_h / 2


def unmeasured() -> list[tuple[str, float, str]]:
    return [(k, float(v), v.note) for k, v in globals().items() if isinstance(v, Est)]


# ════════════════════════════════════════════════════════════════════════════
#  GEOMETRY
# ════════════════════════════════════════════════════════════════════════════

from build123d import (  # noqa: E402  (parameters first, so they read cleanly)
    Align, Axis, Box, Color, Compound, Cone, Cylinder, Face, Location, Part, Pos,
    Rot, RectangleRounded, Text, Wire, chamfer, export_step, export_stl, extrude,
)

MIN = (Align.MIN, Align.MIN, Align.MIN)
BOT = (Align.CENTER, Align.CENTER, Align.MIN)
EPS = 0.01
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"


def box(x0, x1, y0, y1, z0, z1):
    return Pos(x0, y0, z0) * Box(x1 - x0, y1 - y0, z1 - z0, align=MIN)


def cyl(x, y, z0, h, d):
    return Pos(x, y, z0) * Cylinder(d / 2, h, align=BOT)


def wall_prism(wall_name: str, pts_uz, start: float, depth: float):
    """Extrude a (u, z) outline through a wall.

    start is the offset of the outline's plane from the wall's inside face,
    measured into the cavity; depth runs outward from there.
    """
    if wall_name == "rear":
        pts = [(u, cav_d - start, z) for u, z in pts_uz]
        d = (0, 1, 0)
    elif wall_name == "front":
        pts = [(u, start, z) for u, z in pts_uz]
        d = (0, -1, 0)
    elif wall_name == "right":
        pts = [(cav_w - start, u, z) for u, z in pts_uz]
        d = (1, 0, 0)
    else:
        pts = [(start, u, z) for u, z in pts_uz]
        d = (-1, 0, 0)
    return extrude(Face(Wire.make_polygon(pts, close=True)), amount=depth, dir=d)


def peaked(u0, u1, z0, z1):
    """A rectangle with a 45° roof, so its top prints without a bridge."""
    uc, half = (u0 + u1) / 2, (u1 - u0) / 2
    return [(u0, z0), (u1, z0), (u1, z1), (uc, z1 + half), (u0, z1)]


def teardrop(uc, zc, r, n=20):
    """A circle with a 45° point on top, for a horizontal hole."""
    pts = []
    for i in range(n + 1):
        a = math.radians(45 - 270 * i / n)  # from 45° clockwise round the bottom to 135°
        pts.append((uc + r * math.cos(a), zc + r * math.sin(a)))
    pts.append((uc, zc + r * math.sqrt(2)))
    return pts


def through_cut(wall_name, pts_uz):
    return wall_prism(wall_name, pts_uz, EPS, wall + 2 * EPS)


def lid_boss(name, x, y):
    """M3 insert boss, floor to wall top, tied into its wall or corner."""
    b = cyl(x, y, -EPS, cav_h + EPS, lid_boss_d)
    if name.startswith("rear wall"):
        b = b + box(x - lid_boss_d / 2, x + lid_boss_d / 2, y, cav_d + EPS, -EPS, cav_h)
    else:
        bx0, bx1 = (-EPS, x) if x < cav_w / 2 else (x, cav_w + EPS)
        by0, by1 = (-EPS, y) if y < cav_d / 2 else (y, cav_d + EPS)
        b = b + box(bx0, bx1, by0, by1, -EPS, cav_h)
    return b


def accessory_pad(side, u):
    """Inside pad with a 45° underside, so it prints without support."""
    zb, zt = acc_z - acc_pad_h / 2, acc_z + acc_pad_h / 2
    outline = [(0, zb - acc_pad_depth), (acc_pad_depth, zb), (acc_pad_depth, zt), (0, zt)]  # (depth, z)
    if side == "left":
        pts = [(d, u - acc_pad_w / 2, z) for d, z in outline]
    else:
        pts = [(cav_w - d, u - acc_pad_w / 2, z) for d, z in outline]
    pad = extrude(Face(Wire.make_polygon(pts, close=True)), amount=acc_pad_w, dir=(0, 1, 0))
    # From acc_depth in from the outside face, out through it
    bore = wall_prism(side, teardrop(u, acc_z, insert_m3_bore / 2), acc_depth - wall, acc_depth + EPS)
    return pad, bore


def make_tray(pi_bosses: bool = True) -> Part:
    tray = box(-wall, cav_w + wall, -wall, cav_d + wall, -floor_t, cav_h) - box(0, cav_w, 0, cav_d, 0, cav_h + 1)
    adds = [lid_boss(n, x, y) for n, (x, y) in lid_screws.items()]
    if pi_bosses:
        adds += [cyl(x, y, -EPS, standoff_h + EPS, pi_boss_d) for x, y in pi_holes]
    bores = []
    for side, u in accessory:
        pad, bore = accessory_pad(side, u)
        adds.append(pad)
        bores.append(bore)
    tray = tray.fuse(*adds).clean()

    cuts = []
    # Insert bores
    cuts += [cyl(x, y, cav_h - insert_m3_len - 1.0, insert_m3_len + 1.0 + EPS, insert_m3_bore)
             for x, y in lid_screws.values()]
    if pi_bosses:
        cuts += [cyl(x, y, standoff_h - insert_m25_len - 1.0, insert_m25_len + 1.0 + EPS, insert_m25_bore)
                 for x, y in pi_holes]
    cuts += bores
    # USB-C power window and the USB/Ethernet notch
    cuts.append(through_cut(pwr_wall, peaked(pwr_u - pwr_win_w / 2, pwr_u + pwr_win_w / 2,
                                             pwr_win_z0, pwr_win_z0 + pwr_win_h)))
    cuts.append(through_cut(usb_wall, [(notch_u0, notch_z0), (notch_u1, notch_z0),
                                       (notch_u1, cav_h + 1), (notch_u0, cav_h + 1)]))
    # Side vents
    cuts += [through_cut(vent_wall, peaked(u - side_slot_w / 2, u + side_slot_w / 2,
                                           side_slot_z0, side_slot_z0 + side_slot_h - side_slot_w / 2))
             for u in side_slots_u]
    # Floor slots and foot recesses
    cuts += [Pos(x, y, -floor_t - EPS) * Box(floor_slot_l, floor_slot_w, floor_t + 2 * EPS, align=BOT)
             for x, y in floor_slots]
    cuts += [cyl(x, y, -floor_t - EPS, foot_recess_t + EPS, foot_recess_d) for x, y in feet]
    return tray.cut(*cuts).clean()


def post_outline(corner: str):
    """The L of one corner post, in cavity XY: legs run post_leg along each face."""
    sx = -1 if "left" in corner else 1
    sy = -1 if "front" in corner else 1
    ox = 0 if sx < 0 else cav_w   # the cavity corner the post wraps
    oy = 0 if sy < 0 else cav_d
    L, t = post_leg + fit, post_t
    local = [(0, 0), (-L, 0), (-L, t), (t, t), (t, -L), (0, -L)]  # outside is +x/+y here
    return [(ox + sx * px, oy + sy * py) for px, py in local], (ox, oy)


def make_post(corner: str, h: float, z0: float, with_chamfer: bool) -> Part:
    pts, (ox, oy) = post_outline(corner)
    post = extrude(Face(Wire.make_polygon([(x, y, z0) for x, y in pts], close=True)), amount=h, dir=(0, 0, 1))
    if with_chamfer and post_chamfer > 0:
        top = post.edges().group_by(Axis.Z)[-1]
        inner = [e for e in top
                 if (abs(e.center().X - ox) < 1e-6 and (e.center().Y - oy) * (1 if oy == 0 else -1) > 0)
                 or (abs(e.center().Y - oy) < 1e-6 and (e.center().X - ox) * (1 if ox == 0 else -1) > 0)]
        post = chamfer(inner, post_chamfer)
    return post


CORNERS = ("front-left", "front-right", "rear-left", "rear-right")


def make_lid() -> Part:
    lid = box(-wall, cav_w + wall, -wall, cav_d + wall, cav_h, deck_z)
    lid = lid.fuse(*[make_post(c, post_h, deck_z - EPS, True) for c in CORNERS]).clean()
    csk_h = (m3_csk_d - m3_clear_d) / 2  # 90° countersink
    cuts = []
    for x, y in lid_screws.values():
        cuts.append(cyl(x, y, cav_h - EPS, lid_t + 2 * EPS, m3_clear_d))
        cuts.append(Pos(x, y, deck_z - csk_h) * Cone(m3_clear_d / 2, m3_csk_d / 2 + EPS, csk_h + EPS, align=BOT))
    return lid.cut(*cuts).clean()


def make_fit_test_solo() -> Part:
    """A thin ring with a 2 mm slice of each corner post: checks the Solo's fit."""
    ring = (box(-wall, cav_w + wall, -wall, cav_d + wall, 0, fit_ring_t)
            - box(fit_ring_w - wall, cav_w + wall - fit_ring_w, fit_ring_w - wall, cav_d + wall - fit_ring_w, -1, 2))
    return ring.fuse(*[make_post(c, fit_post_slice_h, fit_ring_t - EPS, False) for c in CORNERS]).clean()


def make_fit_test_pi() -> Part:
    """The four Pi bosses on a plate, plus one M3 lid-insert boss to practise on."""
    hx, hy = pi_hole_pitch_x / 2, pi_hole_pitch_y / 2
    px = hx + pi_boss_d / 2 + fit_plate_margin
    py = hy + pi_boss_d / 2 + fit_plate_margin
    plate = box(-px, px, -py, py, 0, floor_t)
    win_x, win_y = hx - pi_boss_d / 2 - 3, hy - pi_boss_d / 2 - 3
    plate = plate - box(-win_x, win_x, -win_y, win_y, -1, floor_t + 1)
    ear_x = px + lid_boss_d / 2 + 3
    ear = box(px - EPS, ear_x + lid_boss_d / 2 + fit_plate_margin, -lid_boss_d / 2 - fit_plate_margin,
              lid_boss_d / 2 + fit_plate_margin, 0, floor_t)
    m3_h = insert_m3_len + 2.0
    bosses = [cyl(sx * hx, sy * hy, floor_t - EPS, standoff_h + EPS, pi_boss_d) for sx in (-1, 1) for sy in (-1, 1)]
    bosses.append(cyl(ear_x, 0, floor_t - EPS, m3_h + EPS, lid_boss_d))
    part = plate.fuse(ear, *bosses).clean()
    cuts = [cyl(sx * hx, sy * hy, floor_t + standoff_h - insert_m25_len - 1.0, insert_m25_len + 1.0 + EPS,
                insert_m25_bore) for sx in (-1, 1) for sy in (-1, 1)]
    cuts.append(cyl(ear_x, 0, floor_t + m3_h - insert_m3_len - 1.0, insert_m3_len + 1.0 + EPS, insert_m3_bore))
    label = Pos(0, -hy - 0.2, floor_t - 0.4) * extrude(Text(f"M2.5 {insert_m25_bore:g}  M3 {insert_m3_bore:g}",
                                                             font_size=3.2), amount=0.4 + EPS)
    cuts.append(label)
    return part.cut(*cuts).clean()


def make_pi() -> dict[str, Part]:
    """Board-plus-ports placeholder from the official mechanical drawing."""
    t = pi_board_t
    board = Pos(pi_board_l / 2, pi_board_w / 2, 0) * extrude(
        RectangleRounded(pi_board_l, pi_board_w, pi_corner_r), amount=t)
    board = board.cut(*[cyl(pi_hole_inset + i * pi_hole_pitch_x, pi_hole_inset + j * pi_hole_pitch_y,
                            -1, t + 2, pi_hole_d) for i in (0, 1) for j in (0, 1)])
    metal = [box(xc - w / 2, xc + w / 2, -_edge_oh[n], 6.5, t, t + h) for n, xc, w, h in edge_ports
             if n != "audio"]
    metal += [box(pi_board_l + pi_usb_overhang - length, pi_board_l + pi_usb_overhang, ya, yb, t, t + h)
              for n, ya, yb, h, length in end_ports]
    black = [box(7.1, 57.9, 50.0, 55.0, t, t + 8.5)]
    if pi_model == 4:
        black.append(box(50.5, 57.5, 0, 12.5, t, t + 6.0))
        black.append(Pos(54.0, 0, t + 3.0) * Rot(90, 0, 0) * Cylinder(3.0, pi_audio_overhang, align=BOT))
    sink = [box(21.75, 36.75, 25.0, 40.0, t, t + pi_heatsink_top)]
    sd = [box(-pi_sd_protrude, 12.0, 22.51, 33.51, -1.4, 0)]
    loc = Pos(pi_tx, pi_ty, board_bot_z) * Rot(0, 0, pi_rot)
    return {"board": loc * board, "metal": loc * Compound(children=metal),
            "black": loc * Compound(children=black + sd), "heatsink": loc * Compound(children=sink)}


def make_solo() -> dict[str, Part]:
    """A placeholder Solo: body, feet, and the rear USB-C and XLR."""
    x0, y0, z0 = fit, fit, deck_z
    body = box(x0, x0 + solo_w, y0, y0 + solo_d, z0 + solo_foot_h, z0 + solo_foot_h + solo_h)
    feet_ = [cyl(x0 + fx, y0 + fy, z0, solo_foot_h, 8) for fx in (12, solo_w - 12) for fy in (12, solo_d - 12)]
    rear = y0 + solo_d
    xlr_x = x0 + 28.0
    jacks = [Pos(xlr_x, rear, z0 + solo_xlr_z + 12) * Rot(-90, 0, 0) * Cylinder(12, 1.5, align=BOT),
             box(x0 + solo_usb_x - 4.5, x0 + solo_usb_x + 4.5, rear, rear + 1.0, z0 + 14, z0 + 17.5)]
    return {"body": body, "feet": Compound(children=feet_), "jacks": Compound(children=jacks)}


def build() -> dict:
    return {
        "tray": make_tray(),
        "lid": make_lid(),
        "fit_test_pi": make_fit_test_pi(),
        "fit_test_solo": make_fit_test_solo(),
        "pi": make_pi(),
        "solo": make_solo(),
    }


def print_pose(part: Part) -> Part:
    """Move a part so it sits on the bed at z = 0, centred on the origin."""
    bb = part.bounding_box()
    return Pos(-(bb.min.X + bb.max.X) / 2, -(bb.min.Y + bb.max.Y) / 2, -bb.min.Z) * part


def export(parts: dict) -> None:
    OUT.mkdir(exist_ok=True)
    for name in ("tray", "lid"):
        p = print_pose(parts[name])
        export_step(p, OUT / f"{name}.step")
        export_stl(p, OUT / f"{name}.stl", tolerance=0.01, angular_tolerance=0.1)
    fpi, fsolo = print_pose(parts["fit_test_pi"]), print_pose(parts["fit_test_solo"])
    export_stl(fpi, OUT / "fit_test_pi.stl", tolerance=0.01, angular_tolerance=0.1)
    export_stl(fsolo, OUT / "fit_test_solo.stl", tolerance=0.01, angular_tolerance=0.1)
    export_stl(Compound(children=[fsolo, fpi]), OUT / "fit_test.stl", tolerance=0.01, angular_tolerance=0.1)  # plate prints inside the ring

    def tag(shape, label, rgb):
        shape.label, shape.color = label, Color(*rgb)
        return shape

    pi = Compound(label="raspberry_pi_placeholder", children=[
        tag(parts["pi"]["board"], "board", (0.13, 0.45, 0.2)),
        tag(parts["pi"]["metal"], "ports", (0.75, 0.75, 0.75)),
        tag(parts["pi"]["black"], "header_audio_sd", (0.1, 0.1, 0.1)),
        tag(parts["pi"]["heatsink"], "heatsink", (0.55, 0.55, 0.6))])
    solo = Compound(label="scarlett_solo_placeholder", children=[
        tag(parts["solo"]["body"], "body", (0.75, 0.1, 0.1)),
        tag(parts["solo"]["feet"], "feet", (0.1, 0.1, 0.1)),
        tag(parts["solo"]["jacks"], "rear_jacks", (0.2, 0.2, 0.2))])
    asm = Compound(label="hindsight_kit", children=[
        tag(parts["tray"].located(Location()), "tray", (0.91, 0.86, 0.76)),
        tag(parts["lid"].located(Location()), "lid", (0.80, 0.74, 0.62)),
        pi, solo])
    export_step(asm, OUT / "assembly.step")


def main(argv: list[str]) -> None:
    parts = build()
    export(parts)
    import report
    report.main(parts)
    if "--no-render" not in argv:
        import render
        render.main(parts)


if __name__ == "__main__":
    main(sys.argv[1:])
