"""Hindsight kit enclosure: a Pi 4 case that rides on top of the Scarlett Solo.

    make            # build, export, render and rewrite REPORT.md
    .venv/bin/python kit.py [--no-render]

Every dimension lives in the parameter block below. A value wrapped in
est(...) is published or guessed and not yet checked with calipers. When you
measure one, replace the whole right-hand side with the number, for example

    pi_usb_overhang = 3.1  # measured 2026-10-08

and re-run `make`. REPORT.md lists every est(...) still left.

Coordinates: millimetres, origin at the inside front-left corner of the
case's cavity, on its floor; X runs left to right seen from the front, Y runs
front to back, Z runs up. The Solo sits below the case.
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
usb_side = "right"  # "right" or "left": the end of the Solo its rear USB-C is on; the case sits on that end
pi_model = 4        # 4 or 5

# ── Scarlett Solo 4th Gen (not here yet: every value is unmeasured) ─────────
solo_w = est(143.0, "Focusrite: overall width")
solo_d = est(96.0, "Focusrite: overall depth")
solo_h = est(46.5, "Focusrite: overall height")
solo_foot_h = est(2.0, "guess: height of the bottom feet")
solo_usb_x = est(118.0, "guess: rear USB-C centre from the left end, seen from the front")
solo_usb_z = est(23.0, "guess: rear USB-C centre above the bottom of the body")

# Where the case sits on the Solo's top
case_rear_inset = 0.0  # the case's rear face this far forward of the Solo's rear face
case_end_inset = 0.0   # the case's side face this far in from the Solo's usb_side end

# ── Raspberry Pi board (official Pi 4 mechanical drawing, RP-008343) ────────
pi_board_l = 85.0
pi_board_w = 56.0
pi_board_t = 1.3  # read by eye as just over 1 mm (2026-10-07); Pi 4s are 1.4–1.6. Modelled mid-range,
                  # and stack_tol below covers 1.0–1.6
pi_corner_r = 3.0
pi_hole_d = 2.7
pi_hole_pitch_x = 58.0  # along the board's length
pi_hole_pitch_y = 49.0  # across it
pi_hole_inset = 3.5     # from the SD-card end and the power edge

# How far each connector reaches past the board edge
pi_usb_overhang = 4.0  # measured 2026-10-07 (drawing: 3.0)
pi_usbc_overhang = 1.0  # measured 2026-10-07 (drawing: 1.25)
pi_hdmi_overhang = est(1.43, "drawing: micro-HDMI body starts at Y -1.43")
pi_audio_overhang = 2.0  # measured 2026-10-07 (drawing: 2.5)
pi_sd_protrude = 3.0  # measured 2026-10-07 (drawing: 2.27)

# Heights above the board's top face
pi_tallest = 15.0  # measured 2026-10-07: the tallest part above the board (drawing: 16.0)
pi_heatsink_top = 8.5  # measured 2026-10-07: the kit's small heatsink stays below the GPIO pins
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

# ── Case ────────────────────────────────────────────────────────────────────
wall = 2.4        # 6 perimeters at 0.4
floor_t = 2.4
lid_t = 2.4               # a whole number of 0.2 mm layers
layer_h = 0.2
lid_seat_gap = 0.3        # at least this between the wall tops and the lid, so the lid clamps on the spacers
boss_h = 4.0              # the Pi's bosses on the floor (2.5 mm under the board's deepest part)
screw_past_nut = 1.0      # how far the screw tip should reach past the nut; sets the spacers' length
spacer_d = 5.5            # their outside diameter (round, so no corner can turn toward the USB-C)
case_margin_left = 3.0    # beside the GPIO header
case_margin_front = 0.5   # beyond the SD card's tip
port_gap = 0.5            # the power-edge connectors stop this far short of the inside wall
rear_jack_proud = 0.5     # USB-A/Ethernet faces stop this far inside the rear wall's outer face
min_clearance = 0.5       # REPORT.md flags anything tighter

# ── Screws and nuts (hardware on hand, no heat-set inserts) ─────────────────
# One screw per corner runs down through the lid, a spacer, the Pi's hole and the boss into a
# nut pressed up into a hex pocket from the case's underside. Tightening pulls the nut up while
# the board pushes down, squeezing the plastic between them: lid, spacer, Pi and case clamp as one.
screw_size = "M2.5"       # the Pi's own size: its holes are 2.7 mm
screw_len = 25.0          # the longest on hand (a countersunk screw's length is overall)
screw_clear_d = 2.9       # through the lid, spacers and bosses
screw_csk_d = 5.0         # countersink at the lid's top face (an M2.5 flat head is 4.7)
nut_af = 5.0              # M2.5 nut across the flats (ISO 4032)
nut_t = 2.0
nut_fit = 0.1             # pocket clearance across the flats: a snug press fit
nut_roof = 1.6            # plastic between the nut and the board, squeezed by the clamp
pi_boss_d = 7.5           # 0.8 mm of plastic round the nut pocket's corners
boss_top_chamfer = 0.75   # 45°: keeps the boss's contact face (6.0 mm) inside the Pi's 6 mm mounting pad
# Tolerances for the screw-stack checks in REPORT.md
stack_tol = 0.6           # board ±0.3 (1.0–1.6), printed spacer ±0.2, lid ±0.1, worst way round
screw_len_tol = 0.42      # ISO js15 on a 25 mm screw
screw_tip_chamfer = 0.45  # the last thread of a screw (one 0.45 mm pitch) isn't full
screw_head_d = 4.7        # an M2.5 flat head; it sinks (screw_csk_d - screw_head_d)/2 below the lid's top

# ── Magnets for the clip saddle (later): one D8×3 under each Dual Lock square ─
magnet_d = 8.0
magnet_t = 3.0
magnet_fit = 0.2          # pocket clearance on the diameter (press fit plus a drop of glue)
magnet_roof = 0.6         # plastic above the pocket inside the case

# ── Openings ────────────────────────────────────────────────────────────────
pwr_win_w = 13.0          # USB-C power window in the right wall, peaked top at 45°
pwr_win_h = 8.0
pwr_plug_w = est(11.0, "guess: official 15 W supply's USB-C plug body width")
pwr_plug_h = est(6.5, "guess: its height")
usb_plug_w = est(16.0, "guess: a USB-A plug body's width, for the notch edges")
usb_plug_h = est(8.0, "guess: a USB-A plug body's height")
usb_low_port_zc = est(4.2, "guess: the lower USB-A port's centre above the board top")
notch_floor_drop = 2.5    # the rear notch's floor sits this far below the board top
sd_slot_w = 15.0          # front-wall slot to pull the SD card without opening the case
sd_slot_z0 = 1.0

# ── Cable from the Pi to the Solo ─────────────────────────────────────────────
usb_cable_len = 150.0     # the BOM's 15–20 cm, short end
plug_body_len = 20.0      # each end's plug body and strain relief, which the cable can't bend inside
pwr_plug_room = 40.0      # room a power plug and its bend need beside the case (usb_side = left)

# ── Vents ───────────────────────────────────────────────────────────────────
floor_slot_w = 2.0
floor_slot_l = 20.0
floor_slot_pitch = 4.0
side_slot_w = 2.0
side_slot_h = 12.0        # vertical slots with 45° peaked tops, no bridges
side_slot_pitch = 4.0
side_vent_len = 40.0
lid_slot_w = 2.0
lid_slot_l = 20.0
lid_slot_pitch = 4.0
lid_vent_rows = 8         # plain lid: slots over the SoC, so warm air leaves through the top

# ── Dual Lock pads under the case ───────────────────────────────────────────
dl_pad = 25.4             # 1" squares (3M SJ3550/SJ3560)
dl_mated_t = 5.7          # SJ3550 mated to itself; SJ3560 is about 7.1
dl_inset = 4.0            # a pad's edge from the case's outside edge (clear of the rounded corners)
dl_groove_w = 0.8         # locating groove round each pad, on the bottom face
dl_groove_d = 0.4
dl_groove_gap = 0.5

# ── Look ────────────────────────────────────────────────────────────────────
case_corner_r = 6.0       # outside vertical corners of the case and lid
lid_edge_r = 1.2          # rounded top edge of the lid
case_bottom_chamfer = 0.8 # 45°: prints without support, where a fillet wouldn't
lid_style = "portastudio" # "portastudio" (a cassette 4-track's top panel) or "plain" (vent slots)
engrave = 0.5             # depth of engraved lines and symbols
line_w = 0.8              # engraved lines: two nozzle widths, so a 0.4 nozzle prints them
wordmark = "hindsight"
wordmark_size = 8.0       # plain lid; the portastudio lid puts it on the cassette label

# The portastudio lid, front to back. X positions are across the case, centred.
ch_pitch = 12.0           # four channel strips
fader_slot_w = 2.4        # through-slots: they vent the lid
fader_y = (6.0, 32.0)     # slot ends, case Y
fader_levels = (0.62, 0.40, 0.75, 0.30)  # where each fader cap sits, 0 = front end
fader_cap = (8.0, 4.0, 2.4)              # width, depth, height above the lid
knob_y, knob_d, knob_h = 38.0, 7.0, 2.0
button_y, button = 45.5, (8.0, 5.0, 1.0)  # transport keys: width, depth, height
cassette_x = (11.0, 51.0)                # recessed cassette window, case X
cassette_y = (52.0, 86.0)
cassette_depth = 0.8
hub_pitch, hub_d = 24.0, 11.0            # the two reel hubs: through-holes with six teeth

# ── Fit test ────────────────────────────────────────────────────────────────
fit_plate_margin = 2.0

# ════════════════════════════════════════════════════════════════════════════
#  DERIVED
# ════════════════════════════════════════════════════════════════════════════

assert usb_side in ("right", "left"), usb_side
assert pi_model in (4, 5), pi_model

edge_ports = PI_EDGE_PORTS[pi_model]
end_ports = PI_END_PORTS[pi_model]
_edge_oh = {"USB-C power": pi_usbc_overhang, "micro-HDMI 0": pi_hdmi_overhang,
            "micro-HDMI 1": pi_hdmi_overhang, "audio": pi_audio_overhang}
edge_overhang = float(max(_edge_oh[name] for name, *_ in edge_ports))

# The Pi lies with its USB-A/Ethernet end to the rear, so the cable drops
# straight down to the Solo's rear USB-C. The board is chiral: that puts its
# power/HDMI edge on the right, so power comes in through the right wall.
cav_w = case_margin_left + pi_board_w + edge_overhang + port_gap
pi_tx = cav_w - port_gap - edge_overhang                   # board's right (power) edge
pi_ty = pi_sd_protrude + case_margin_front                 # board's front (SD) end
usb_face_y = pi_ty + pi_board_l + pi_usb_overhang
cav_d = usb_face_y + rear_jack_proud - wall                # the jacks reach into the open rear notch
out_x0, out_x1 = -wall, cav_w + wall
out_y0, out_y1 = -wall, cav_d + wall
out_w, out_d = out_x1 - out_x0, out_y1 - out_y0
board_bot_z = boss_h
board_top_z = boss_h + pi_board_t
# Printed spacers, board top to lid underside: as long as lets the screw reach screw_past_nut past its nut
spacer_len = round(screw_len - lid_t - pi_board_t - nut_roof - nut_t - screw_past_nut, 1)
cav_h = board_top_z + spacer_len                            # lid underside, on the spacer tops
wall_top = math.floor((floor_t + cav_h - lid_seat_gap) / layer_h + 1e-6) * layer_h - floor_t  # on a layer
case_h = floor_t + cav_h + lid_t
assert pi_ty + pi_board_l < cav_d, "the board itself must stay inside the cavity"


@dataclass
class Box3:
    name: str
    x0: float
    x1: float
    y0: float
    y1: float
    z0: float
    z1: float


def pi_xy(x: float, y: float) -> tuple[float, float]:
    """Board-frame (x, y) to case (X, Y): rotated 90° anticlockwise."""
    return pi_tx - y, pi_ty + x


def pi_box(x0, x1, y0, y1, z0, z1, name):
    """A board-frame box (z above the board's top face) as a case AABB."""
    (ax, ay), (bx, by) = pi_xy(x0, y0), pi_xy(x1, y1)
    return Box3(name, min(ax, bx), max(ax, bx), min(ay, by), max(ay, by),
                board_top_z + z0, board_top_z + z1)


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
board_box, sd_box, sink_box = pi_keepout[0], pi_keepout[1], pi_keepout[2]
pi_holes = [pi_xy(pi_hole_inset + i * pi_hole_pitch_x, pi_hole_inset + j * pi_hole_pitch_y)
            for i in (0, 1) for j in (0, 1)]
nut_corner_r = (nut_af + nut_fit) / math.sqrt(3)            # half across the corners
nut_top_z = boss_h - nut_roof                                # the pocket's roof, where the nut bears
nut_bottom_z = nut_top_z - nut_t
screw_tip_z = cav_h + lid_t - screw_len                     # flush countersunk head
head_sink = (screw_csk_d - screw_head_d) / 2

# USB-C power window, centred on the receptacle (Y along the right wall)
_usbc = next(p for p in edge_ports if p[0] == "USB-C power")
pwr_y = pi_xy(_usbc[1], 0)[1]
pwr_zc = board_top_z + _usbc[3] / 2
pwr_win_z0 = pwr_zc - pwr_win_h / 2

# The rear notch over the USB-A and Ethernet stacks: from the board's left
# edge (less 0.5) to the right wall, floor below the board top, open on top.
notch_x0 = board_box.x0 + 0.5
notch_x1 = cav_w
notch_z0 = board_top_z - notch_floor_drop

# The SD-card slot in the front wall
sd_x = (sd_box.x0 + sd_box.x1) / 2
sd_slot_z1 = board_bot_z - 0.2

# usb_side should agree with where the Solo's USB-C actually is
usb_side_agrees = (solo_usb_x > solo_w / 2) == (usb_side == "right")

# The Solo, in case coordinates
solo_top_z = -floor_t - dl_mated_t
solo_x0 = out_x1 - case_end_inset - solo_w if usb_side == "right" else out_x0 + case_end_inset
solo_y0 = out_y1 + case_rear_inset - solo_d
solo_body_z0 = solo_top_z - solo_h
controls_h = (fader_cap[2] if lid_style != "plain" else 0.0)
stack_h = solo_foot_h + solo_h + dl_mated_t + case_h + controls_h

# Dual Lock pads (outline in case X/Y, on the bottom face)
dl_pads = []
for _sx in (0, 1):
    for _sy in (0, 1):
        _x0 = out_x0 + dl_inset if _sx == 0 else out_x1 - dl_inset - dl_pad
        # The rear pair moves forward if it must, so each square covers a nut pocket
        _y0 = out_y0 + dl_inset if _sy == 0 else min(out_y1 - dl_inset - dl_pad,
                                                    max(hy for _, hy in pi_holes) - nut_corner_r - 1.0)
        dl_pads.append(Box3("pad", _x0, _x0 + dl_pad, _y0, _y0 + dl_pad, 0, 0))
magnets = [((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2) for p in dl_pads]  # centred under each Dual Lock square
magnet_pocket_d = magnet_d + magnet_fit
magnet_bump_h = magnet_t + magnet_fit / 2 + magnet_roof - floor_t  # local floor thickening inside the case


def _circle_box_gap(cx, cy, r, b: Box3) -> float:
    dx = max(b.x0 - cx, 0, cx - b.x1)
    dy = max(b.y0 - cy, 0, cy - b.y1)
    return math.hypot(dx, dy) - r


def _box_box_gap(a: Box3, b: Box3) -> float:
    return max(b.x0 - a.x1, a.x0 - b.x1, b.y0 - a.y1, a.y0 - b.y1)


def slot_grid(x0, x1, y0, y1, length, width, pitch, circles, boxes):
    """Centres of slots (long axis along X) filling a rectangle, clear of keep-outs."""
    ncol = max(int((x1 - x0 + pitch) // (length + pitch)), 0)
    span = ncol * length + (ncol - 1) * pitch
    xs = [x0 + (x1 - x0 - span) / 2 + length / 2 + i * (length + pitch) for i in range(ncol)]
    nrow = max(int((y1 - y0 - width) // pitch) + 1, 0)
    ys = [y0 + (y1 - y0 - (nrow - 1) * pitch) / 2 + j * pitch for j in range(nrow)]
    out = []
    for x in xs:
        for y in ys:
            s = Box3("slot", x - length / 2, x + length / 2, y - width / 2, y + width / 2, 0, 0)
            if all(_circle_box_gap(cx, cy, r, s) > 0 for cx, cy, r in circles) and \
                    all(_box_box_gap(s, b) > 0 for b in boxes):
                out.append((x, y))
    return out


_ring = dl_groove_gap + dl_groove_w + 1.5
_pad_keep = [Box3("k", p.x0 - _ring, p.x1 + _ring, p.y0 - _ring, p.y1 + _ring, 0, 0) for p in dl_pads]
floor_slots = slot_grid(board_box.x0 + 3, board_box.x1 - 3, board_box.y0 + 3, board_box.y1 - 3,
                        floor_slot_l, floor_slot_w, floor_slot_pitch,
                        [(hx, hy, pi_boss_d / 2 + 1.5) for hx, hy in pi_holes], _pad_keep)
_lid_yc = (sink_box.y0 + sink_box.y1) / 2
_lid_half = ((lid_vent_rows - 1) * lid_slot_pitch + lid_slot_w) / 2
lid_slots = slot_grid(board_box.x0 + 3, board_box.x1 - 3, _lid_yc - _lid_half, _lid_yc + _lid_half,
                      lid_slot_l, lid_slot_w, lid_slot_pitch,
                      [(hx, hy, screw_csk_d / 2 + 2) for hx, hy in pi_holes], [])
side_slots_y = [cav_d / 2 - side_vent_len / 2 + side_slot_w / 2 + i * side_slot_pitch
                for i in range(int((side_vent_len - side_slot_w) // side_slot_pitch) + 1)]
side_slot_z0 = cav_h / 2 - side_slot_h / 2
wordmark_y = (max(hy for _, hy in pi_holes) + screw_csk_d / 2 + out_y1) / 2
cav_xc = cav_w / 2
ch_x = [cav_xc + (i - 1.5) * ch_pitch for i in range(4)]


def unmeasured() -> list[tuple[str, float, str]]:
    return [(k, float(v), v.note) for k, v in globals().items() if isinstance(v, Est)]


# ════════════════════════════════════════════════════════════════════════════
#  GEOMETRY
# ════════════════════════════════════════════════════════════════════════════

from build123d import (  # noqa: E402  (parameters first, so they read cleanly)
    Align, Axis, Box, Circle, Color, Compound, Cone, Cylinder, Face, Location, Part, Pos,
    FontStyle, Rectangle, RectangleRounded, RegularPolygon, Rot, SlotOverall, Text, Wire, chamfer, export_step,
    export_stl, extrude, fillet,
)

MIN = (Align.MIN, Align.MIN, Align.MIN)
BOT = (Align.CENTER, Align.CENTER, Align.MIN)
EPS = 0.01
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
STL_TOL = dict(tolerance=0.01, angular_tolerance=0.1)


def box(x0, x1, y0, y1, z0, z1):
    return Pos(x0, y0, z0) * Box(x1 - x0, y1 - y0, z1 - z0, align=MIN)


def cyl(x, y, z0, h, d):
    return Pos(x, y, z0) * Cylinder(d / 2, h, align=BOT)


def wall_prism(wall_name: str, pts_uz):
    """Extrude a (u, z) outline through a wall (u is X on front/rear, Y on left/right)."""
    if wall_name == "front":
        pts, d = [(u, EPS, z) for u, z in pts_uz], (0, -1, 0)
    elif wall_name == "right":
        pts, d = [(cav_w - EPS, u, z) for u, z in pts_uz], (1, 0, 0)
    else:
        pts, d = [(EPS, u, z) for u, z in pts_uz], (-1, 0, 0)
    return extrude(Face(Wire.make_polygon(pts, close=True)), amount=wall + 2 * EPS, dir=d)


def peaked(u0, u1, z0, z1):
    """A rectangle with a 45° roof, so its top prints without a bridge."""
    uc, half = (u0 + u1) / 2, (u1 - u0) / 2
    return [(u0, z0), (u1, z0), (u1, z1), (uc, z1 + half), (u0, z1)]


def rounded_prism(x0, x1, y0, y1, z0, z1, r):
    """A box with rounded vertical edges."""
    rr = RectangleRounded(x1 - x0, y1 - y0, r) if r > 0 else Rectangle(x1 - x0, y1 - y0)
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, z0) * extrude(rr, amount=z1 - z0)


def nut_pocket(x, y, bottom_z, top_z):
    """A hex pocket a nut presses up into from the underside, flats parallel to X."""
    return Pos(x, y, bottom_z) * extrude(RegularPolygon(nut_corner_r, 6), amount=top_z - bottom_z)


def pi_boss(x, y, z0, h):
    boss = cyl(x, y, z0, h, pi_boss_d)
    if boss_top_chamfer > 0:
        boss = chamfer(boss.edges().group_by(Axis.Z)[-1], boss_top_chamfer)
    return boss


def make_case(pi_bosses: bool = True) -> Part:
    shell = rounded_prism(out_x0, out_x1, out_y0, out_y1, -floor_t, wall_top, case_corner_r)
    if case_bottom_chamfer > 0:
        shell = chamfer(shell.edges().group_by(Axis.Z)[0], case_bottom_chamfer)
    case = shell - rounded_prism(0, cav_w, 0, cav_d, 0, cav_h + 1, case_corner_r - wall)
    adds = [cyl(x, y, -EPS, magnet_bump_h + EPS, magnet_pocket_d + 2 * 1.2) for x, y in magnets]
    if pi_bosses:
        adds += [pi_boss(x, y, -EPS, boss_h + EPS) for x, y in pi_holes]
    case = case.fuse(*adds).clean()
    cuts = [cyl(x, y, -floor_t - EPS, magnet_t + magnet_fit / 2 + EPS, magnet_pocket_d) for x, y in magnets]
    if pi_bosses:
        cuts += [nut_pocket(x, y, -floor_t - EPS, nut_top_z) for x, y in pi_holes]
        cuts += [cyl(x, y, nut_top_z - EPS, nut_roof + 2 * EPS, screw_clear_d) for x, y in pi_holes]
    # Openings: power window, rear notch (open on top), SD slot
    cuts.append(wall_prism("right", peaked(pwr_y - pwr_win_w / 2, pwr_y + pwr_win_w / 2,
                                           pwr_win_z0, pwr_win_z0 + pwr_win_h)))
    # Through the right wall's rounded rear end too, so no knife-edge fin is left there
    cuts.append(box(notch_x0, out_x1 + EPS, cav_d - (case_corner_r - wall) - EPS, out_y1 + EPS, notch_z0, cav_h + 1))
    cuts.append(wall_prism("front", peaked(sd_x - sd_slot_w / 2, sd_x + sd_slot_w / 2, sd_slot_z0, sd_slot_z1)))
    # Vents
    cuts += [wall_prism("left", peaked(y - side_slot_w / 2, y + side_slot_w / 2,
                                       side_slot_z0, side_slot_z0 + side_slot_h - side_slot_w / 2))
             for y in side_slots_y]
    cuts += [Pos(x, y, -floor_t - EPS) * Box(floor_slot_l, floor_slot_w, floor_t + 2 * EPS, align=BOT)
             for x, y in floor_slots]
    # Dual Lock locating grooves on the bottom face
    z0, g, w = -floor_t - EPS, dl_groove_gap, dl_groove_w
    for p in dl_pads:
        ring = box(p.x0 - g - w, p.x1 + g + w, p.y0 - g - w, p.y1 + g + w, z0, -floor_t + dl_groove_d)
        cuts.append(ring - box(p.x0 - g, p.x1 + g, p.y0 - g, p.y1 + g, z0 - 1, 0))
    return case.cut(*cuts).clean()


def _engraved(sketch, x, y, top, depth=None):
    d = engrave if depth is None else depth
    return Pos(x, y, top - d) * extrude(sketch, amount=d + EPS)


def _symbol(kind, x, y, z):
    """Transport-key symbols, engraved into a key's top: rewind, play, stop, fast-forward, record."""
    def tri(cx, flip=1, s=1.6):
        pts = [(cx - flip * s * 0.8, y - s, z + EPS), (cx + flip * s * 0.9, y, z + EPS), (cx - flip * s * 0.8, y + s, z + EPS)]
        if flip < 0:
            pts.reverse()  # keep the outline anticlockwise, so the face points up
        return extrude(Face(Wire.make_polygon(pts, close=True)), amount=engrave + EPS, dir=(0, 0, -1))
    if kind == "stop":
        return Pos(x, y, z - engrave) * extrude(Rectangle(2.8, 2.8), amount=engrave + EPS)
    if kind == "rec":
        return Pos(x, y, z - engrave) * extrude(Circle(1.5), amount=engrave + EPS)
    parts_ = {"rew": [tri(x - 1.3, -1), tri(x + 1.3, -1)], "play": [tri(x)],
              "ffwd": [tri(x - 1.3), tri(x + 1.3)]}[kind]
    return parts_[0] if len(parts_) == 1 else parts_[0].fuse(parts_[1])


LID_FEATURES: list = []  # (name, Box3): openings and recesses in the lid's top, for REPORT.md


def make_lid() -> Part:
    LID_FEATURES.clear()
    top = cav_h + lid_t
    lid = rounded_prism(out_x0, out_x1, out_y0, out_y1, cav_h, top, case_corner_r)
    if lid_edge_r > 0:
        lid = fillet(lid.edges().group_by(Axis.Z)[-1], lid_edge_r)
    csk_h = (screw_csk_d - screw_clear_d) / 2  # 90° countersink
    adds, cuts = [], []
    for x, y in pi_holes:
        cuts.append(cyl(x, y, cav_h - EPS, lid_t + 2 * EPS, screw_clear_d))
        cuts.append(Pos(x, y, top - csk_h) * Cone(screw_clear_d / 2, screw_csk_d / 2 + EPS, csk_h + EPS, align=BOT))

    if lid_style == "plain":
        cuts += [Pos(x, y, cav_h - EPS) * Box(lid_slot_l, lid_slot_w, lid_t + 2 * EPS, align=BOT)
                 for x, y in lid_slots]
        LID_FEATURES.extend(("vent slot", Box3("s", x - lid_slot_l / 2, x + lid_slot_l / 2, y - lid_slot_w / 2,
                                               y + lid_slot_w / 2, 0, 0)) for x, y in lid_slots)
        if wordmark:
            cuts.append(_engraved(Text(wordmark, font_size=wordmark_size, font_style=FontStyle.BOLD), cav_xc,
                                  wordmark_y, top))
    else:
        y0, y1 = fader_y
        for i, x in enumerate(ch_x):
            # Fader slot (a vent), its scale, channel number, cap, and knob
            LID_FEATURES.append((f"fader slot {i + 1}", Box3("f", x - fader_slot_w / 2, x + fader_slot_w / 2, y0, y1,
                                                             0, 0)))
            cuts.append(Pos(x, (y0 + y1) / 2, cav_h - EPS)
                        * extrude(SlotOverall(y1 - y0, fader_slot_w, rotation=90), amount=lid_t + 2 * EPS))
            cy = y0 + 2 + fader_levels[i] * (y1 - y0 - 4)
            cw, cd, ch = fader_cap
            for t in range(7):
                ty = y0 + 2 + t * (y1 - y0 - 4) / 6
                if abs(ty - cy) < cd / 2 + 0.6:
                    continue  # under the cap it would leave a sealed void
                w = 2.6 if t in (0, 3, 6) else 1.6
                tx = x + fader_slot_w / 2 + 1.0 + w / 2
                tick = Box3("tick", tx - w / 2, tx + w / 2, ty - line_w / 2, ty + line_w / 2, 0, 0)
                if min(_circle_box_gap(hx, hy, screw_csk_d / 2, tick) for hx, hy in pi_holes) < 0.8:
                    continue  # keep clear of the lid screws' countersinks
                cuts.append(_engraved(Rectangle(w, line_w), tx, ty, top))
                LID_FEATURES.append((f"fader {i + 1} scale", tick))
            cuts.append(_engraved(Text(str(i + 1), font_size=5.0, font_style=FontStyle.BOLD), x, y0 - 4.2, top))
            adds.append(Pos(x, cy, top - EPS) * extrude(RectangleRounded(cw, cd, 1.0), amount=ch + EPS))
            adds.append(cyl(x, knob_y, top - EPS, knob_h + EPS, knob_d))
            cuts.append(Pos(x, knob_y + knob_d / 4, top + knob_h - engrave)
                        * extrude(Rectangle(0.8, knob_d / 2), amount=engrave + EPS))
        # Transport keys
        bw, bd, bh = button
        for j, kind in enumerate(("rew", "play", "stop", "ffwd", "rec")):
            x = cav_xc + (j - 2) * (bw + 2.0)
            adds.append(Pos(x, button_y, top - EPS) * extrude(RectangleRounded(bw, bd, 1.2), amount=bh + EPS))
            cuts.append(_symbol(kind, x, button_y, top + bh))
        # The cassette: a recessed window, two toothed reel hubs and the tape window (all three vent)
        cx0, cx1 = cassette_x
        cy0, cy1 = cassette_y
        ccx, ccy = (cx0 + cx1) / 2, (cy0 + cy1) / 2
        cuts.append(_engraved(RectangleRounded(cx1 - cx0, cy1 - cy0, 3.0), ccx, ccy, top, cassette_depth))
        LID_FEATURES.append(("cassette window", Box3("c", cx0, cx1, cy0, cy1, 0, 0)))
        hub_y = ccy - 2.0
        for sx in (-1, 1):
            hx = ccx + sx * hub_pitch / 2
            hole = cyl(hx, hub_y, cav_h - EPS, lid_t + 2 * EPS, hub_d)
            teeth = [Pos(hx, hub_y, cav_h - 1) * Rot(0, 0, a) * Pos(hub_d / 2 - 1.0, 0, 0)
                     * Box(2.4, 1.6, lid_t + 2, align=BOT) for a in range(0, 360, 60)]
            cuts.append(hole.cut(*teeth))
        cuts.append(Pos(ccx, hub_y, cav_h - EPS)
                    * extrude(RectangleRounded(hub_pitch - hub_d - 3.0, 7.0, 1.5), amount=lid_t + 2 * EPS))
        label_y = cy1 - 6.0
        cuts.append(_engraved(Rectangle(cx1 - cx0 - 6.0, line_w), ccx, label_y - 4.5, top - cassette_depth))
        if wordmark:
            cuts.append(_engraved(Text(wordmark, font_size=6.5, font_style=FontStyle.BOLD), ccx, label_y,
                                  top - cassette_depth))
    if adds:
        lid = lid.fuse(*adds).clean()
    return lid.cut(*cuts).clean()


def make_fit_test_pi() -> Part:
    """The four Pi bosses with their nut pockets on a plate like the case floor, plus four loose
    rings the lid's thickness, so the real 25 mm screws can be tried through real spacers."""
    hx, hy = pi_hole_pitch_x / 2, pi_hole_pitch_y / 2
    px = hx + pi_boss_d / 2 + fit_plate_margin
    py = hy + pi_boss_d / 2 + fit_plate_margin
    plate = box(-px, px, -py, py, 0, floor_t)
    win_x, win_y = hx - pi_boss_d / 2 - 3, hy - pi_boss_d / 2 - 3
    plate = plate - box(-win_x, win_x, -win_y, win_y, -1, floor_t + 1)
    holes = [(sx * hx, sy * hy) for sx in (-1, 1) for sy in (-1, 1)]
    part = plate.fuse(*[pi_boss(x, y, floor_t - EPS, boss_h + EPS) for x, y in holes]).clean()
    cuts = [nut_pocket(x, y, -EPS, floor_t + nut_top_z) for x, y in holes]
    cuts += [cyl(x, y, -EPS, floor_t + boss_h + 2 * EPS, screw_clear_d) for x, y in holes]
    cuts.append(Pos(0, -hy - 0.6, floor_t - 0.6)
                * extrude(Text(f"NUT {nut_af + nut_fit:g}", font_size=5.0, font_style=FontStyle.BOLD),
                          amount=0.6 + EPS))
    part = part.cut(*cuts).clean()
    rings = [Pos(sx * 9.0, sy * 7.0, 0)
             * (Cylinder(4.0, lid_t, align=BOT) - Cylinder(screw_clear_d / 2, lid_t, align=BOT))
             for sx in (-1, 1) for sy in (-1, 1)]
    return Compound(children=[part, *rings])


def make_spacers() -> Part:
    """Four printed spacer tubes, standing up as they print."""
    tubes = [Pos(i * (spacer_d + 4.0), 0, 0) * (Cylinder(spacer_d / 2, spacer_len, align=BOT)
                                                - Cylinder(screw_clear_d / 2, spacer_len, align=BOT))
             for i in range(4)]
    return Compound(children=tubes)


def make_pi() -> dict[str, Part]:
    """Board-plus-ports placeholder from the official mechanical drawing, with its spacers."""
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
    loc = Pos(pi_tx, pi_ty, board_bot_z) * Rot(0, 0, 90)
    tubes = [Pos(x, y, board_top_z) * (Cylinder(spacer_d / 2, spacer_len, align=BOT)
                                       - Cylinder(screw_clear_d / 2, spacer_len, align=BOT)) for x, y in pi_holes]
    return {"board": loc * board, "metal": loc * Compound(children=metal),
            "black": loc * Compound(children=black + sd), "heatsink": loc * Compound(children=sink),
            "spacers": Compound(children=tubes)}


def make_solo() -> dict[str, Part]:
    """A placeholder Solo below the case: body, feet, rear USB-C and XLR, and the Dual Lock."""
    x0, y0, z0 = solo_x0, solo_y0, solo_body_z0
    body = box(x0, x0 + solo_w, y0, y0 + solo_d, z0, solo_top_z)
    feet_ = [cyl(x0 + fx, y0 + fy, z0 - solo_foot_h, solo_foot_h, 8)
             for fx in (12, solo_w - 12) for fy in (12, solo_d - 12)]
    rear = y0 + solo_d
    xlr_x = x0 + (28.0 if solo_usb_x > solo_w / 2 else solo_w - 28.0)
    jacks = [Pos(xlr_x, rear, z0 + 23.0) * Rot(-90, 0, 0) * Cylinder(12, 1.5, align=BOT),
             box(x0 + solo_usb_x - 4.5, x0 + solo_usb_x + 4.5, rear, rear + 1.0,
                 z0 + solo_usb_z - 1.7, z0 + solo_usb_z + 1.7)]
    pads = [box(p.x0, p.x1, p.y0, p.y1, solo_top_z, -floor_t) for p in dl_pads]
    return {"body": body, "feet": Compound(children=feet_), "jacks": Compound(children=jacks),
            "dual_lock": Compound(children=pads)}


def build() -> dict:
    return {"case": make_case(), "lid": make_lid(), "fit_test_pi": make_fit_test_pi(),
            "spacers": make_spacers(), "pi": make_pi(), "solo": make_solo()}


def print_pose(part: Part) -> Part:
    """Move a part so it sits on the bed at z = 0, centred on the origin."""
    bb = part.bounding_box()
    return Pos(-(bb.min.X + bb.max.X) / 2, -(bb.min.Y + bb.max.Y) / 2, -bb.min.Z) * part


def export(parts: dict) -> None:
    OUT.mkdir(exist_ok=True)
    for name in ("case", "lid"):
        p = print_pose(parts[name])
        export_step(p, OUT / f"{name}.step")
        export_stl(p, OUT / f"{name}.stl", **STL_TOL)
    export_stl(print_pose(parts["fit_test_pi"]), OUT / "fit_test_pi.stl", **STL_TOL)
    export_stl(print_pose(parts["spacers"]), OUT / "spacers.stl", **STL_TOL)

    def tag(shape, label, rgb):
        shape.label, shape.color = label, Color(*rgb)
        return shape

    pi = Compound(label="raspberry_pi_placeholder", children=[
        tag(parts["pi"]["board"], "board", (0.13, 0.45, 0.2)),
        tag(parts["pi"]["metal"], "ports", (0.75, 0.75, 0.75)),
        tag(parts["pi"]["black"], "header_audio_sd", (0.1, 0.1, 0.1)),
        tag(parts["pi"]["heatsink"], "heatsink", (0.55, 0.55, 0.6)),
        tag(parts["pi"]["spacers"], "printed_spacers", (0.91, 0.86, 0.76))])
    solo = Compound(label="scarlett_solo_placeholder", children=[
        tag(parts["solo"]["body"], "body", (0.75, 0.1, 0.1)),
        tag(parts["solo"]["feet"], "feet", (0.1, 0.1, 0.1)),
        tag(parts["solo"]["jacks"], "rear_jacks", (0.2, 0.2, 0.2)),
        tag(parts["solo"]["dual_lock"], "dual_lock", (0.15, 0.15, 0.15))])
    asm = Compound(label="hindsight_kit", children=[
        tag(parts["case"].located(Location()), "case", (0.91, 0.86, 0.76)),
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
