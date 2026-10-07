"""Writes REPORT.md: clearances, printability and hardware, from the model.

Run through kit.py (`make`). Everything here is computed from kit.py's
parameters and the exported STLs, so the report can't drift from the model.
"""

from __future__ import annotations

import datetime as dt
import math

import numpy as np
import trimesh
from build123d import Compound

import kit

ROWS: list[tuple[str, str, float, float, str]] = []  # (group, item, value, needed, note)
FACET_SLACK = 1.0  # degrees: a curved 45° surface (the chamfer round a corner) tessellates up to ~46°


def row(group, item, value, needed=kit.min_clearance, note=""):
    ROWS.append((group, item, float(value), float(needed), note))


def _status(value, needed, note):
    ok = value >= needed - 1e-6
    unmeasured = "unmeasured" in note
    if ok and not unmeasured:
        return "ok"
    if ok:
        return "ok (unmeasured)"
    return "**TOO TIGHT**" if not unmeasured else "**TOO TIGHT (unmeasured)**"


def _wall_gap(b: kit.Box3, wall: str) -> float:
    return {"left": b.x0, "right": kit.cav_w - b.x1, "front": b.y0, "rear": kit.cav_d - b.y1}[wall]


def _um(*names) -> str:
    """'unmeasured: a, b' for any of the named parameters still est(...)."""
    left = [n for n in names if isinstance(getattr(kit, n), kit.Est)]
    return f"unmeasured: {', '.join(left)}" if left else ""


def clearances(parts) -> None:
    k = kit
    pi_um = "unmeasured: Pi connector overhangs" if _um(
        "pi_usb_overhang", "pi_usbc_overhang", "pi_hdmi_overhang", "pi_audio_overhang", "pi_sd_protrude") else ""

    def note(*parts_):
        return "; ".join(p for p in parts_ if p)

    # ── The Pi to the walls ──
    jack_names = [p[0] for p in k.end_ports]
    others = [b for b in k.pi_keepout if b.name not in jack_names]
    for wall in ("front", "left", "right"):
        nearest = min(k.pi_keepout, key=lambda b: _wall_gap(b, wall))
        extra = "the edge connector that reaches furthest, by design (`port_gap`)" if wall == "right" else ""
        row("The Pi to the walls", f"{wall} wall ← {nearest.name}", _wall_gap(nearest, wall), note=note(pi_um, extra))
    nearest = min(others, key=lambda b: _wall_gap(b, "rear"))
    row("The Pi to the walls", f"rear wall (inside face) ← {nearest.name}", _wall_gap(nearest, "rear"), note=pi_um)
    row("The Pi to the walls", "USB-A/Ethernet faces → rear wall's outside face", k.rear_jack_proud,
        note=note(pi_um, "by design (`rear_jack_proud`): the jacks reach into the open notch"))

    # ── Standoffs (hex, measured across the corners) to the parts on the board ──
    top_parts = [b for b in k.pi_keepout if b.name not in ("board", "SD card")]
    gap, name = min(((k._circle_box_gap(x, y, k.spacer_d / 2, b), b.name) for x, y in k.pi_holes for b in top_parts))
    row("The Pi, spacers and screws", f"spacer tube → nearest part on the board ({name})", gap, note=pi_um)
    walls = min(min(x, k.cav_w - x, y, k.cav_d - y) - k.spacer_d / 2 for x, y in k.pi_holes)
    row("The Pi, spacers and screws", "spacer tube → nearest wall", walls)
    nut_bottom = k.boss_h - k.nut_t - k.nut_pocket_extra
    row("The Pi, spacers and screws", f"M2 × {k.screw_len:g} screw: thread past the bottom of its nut",
        nut_bottom - k.screw_tip_z, needed=0.0, note="0 means the tip just reaches the nut's far face")
    row("The Pi, spacers and screws", "screw tip → bottom of its bore", k.screw_tip_z - k.screw_bore_z0)
    row("The Pi, spacers and screws", "nut pocket corners → outside of the boss", (k.pi_boss_d - k.nut_pocket_d) / 2,
        needed=0.8, note="enough plastic round the pocket")
    row("The Pi, spacers and screws", "magnet pocket roof (inside the case)",
        k.floor_t + k.magnet_bump_h - (k.magnet_t + k.magnet_fit / 2), needed=0.4)

    # ── Up and down ──
    top = max(b.z1 for b in k.pi_keepout if b.name != "heatsink")
    row("The Pi, up and down", "tallest jack top → lid underside", k.cav_h - top, note=_um("pi_tallest"))
    row("The Pi, up and down", "heatsink top → lid underside (spec: 5 mm for airflow)",
        k.cav_h - (k.board_top_z + k.pi_heatsink_top), needed=5.0, note=_um("pi_heatsink_top"))
    row("The Pi, up and down", "board underside parts → floor", k.board_bot_z - k.pi_underside)

    # ── Port faces to their openings ──
    usbc = next(b for b in k.pi_keepout if b.name == "USB-C power")
    w0, w1 = k.pwr_y - k.pwr_win_w / 2, k.pwr_y + k.pwr_win_w / 2
    row("Port faces to openings", "USB-C receptacle → window sides", min(usbc.y0 - w0, w1 - usbc.y1), note=pi_um)
    row("Port faces to openings", "USB-C receptacle → window bottom", usbc.z0 - k.pwr_win_z0)
    row("Port faces to openings", "USB-C plug body → window sides", (k.pwr_win_w - k.pwr_plug_w) / 2,
        note=_um("pwr_plug_w"))
    row("Port faces to openings", "USB-C plug body → window bottom/top", (k.pwr_win_h - k.pwr_plug_h) / 2,
        note=_um("pwr_plug_h"))
    jacks = [b for b in k.pi_keepout if b.name in jack_names]
    for j in jacks:
        row("Port faces to openings", f"{j.name} jack → notch sides", min(j.x0 - k.notch_x0, k.notch_x1 - j.x1),
            note=pi_um)
    row("Port faces to openings", "jack bottoms → notch floor", k.board_top_z - k.notch_z0,
        note="by design (`notch_floor_drop`)")
    plug_bot = k.board_top_z + k.usb_low_port_zc - k.usb_plug_h / 2
    row("Port faces to openings", "lower USB-A plug body → notch floor", plug_bot - k.notch_z0,
        note=_um("usb_low_port_zc", "usb_plug_h"))
    usb_x = sorted((j.x0 + j.x1) / 2 for j in jacks if j.name.startswith("USB"))
    outer = min(usb_x[0] - k.notch_x0, k.notch_x1 - usb_x[-1])
    row("Port faces to openings", "USB-A plug body → notch side (outer stack)", outer - k.usb_plug_w / 2,
        note=_um("usb_plug_w"))
    sd = k.sd_box
    row("Port faces to openings", "SD card → slot sides", min(sd.x0 - (k.sd_x - k.sd_slot_w / 2),
                                                              (k.sd_x + k.sd_slot_w / 2) - sd.x1), note=pi_um)
    row("Port faces to openings", "SD card → slot bottom", sd.z0 - k.sd_slot_z0)

    # ── On the Solo ──
    solo_um = _um("solo_w", "solo_d")
    row("On the Solo", "case front face → Solo front face (the case mustn't overhang the controls)",
        k.out_y0 - k.solo_y0, needed=0.0, note=solo_um)
    pads_in = min(min(p.x0 - k.solo_x0, k.solo_x0 + k.solo_w - p.x1, p.y0 - k.solo_y0, k.solo_y0 + k.solo_d - p.y1)
                  for p in k.dl_pads)
    row("On the Solo", "Dual Lock pads → edge of the Solo's top", pads_in, needed=0.0, note=solo_um)
    if k.usb_side == "left":
        room = k.solo_x0 + k.solo_w - k.out_x1
        row("On the Solo", "room on the Solo's top for the power plug (right of the case)", room,
            needed=k.pwr_plug_room, note=solo_um)
    # Cable: from the nearest Pi USB-A port to the Solo's USB-C, both pointing rearward
    port_z = k.board_top_z + k.usb_low_port_zc
    solo_usb = (k.solo_x0 + k.solo_usb_x, k.solo_body_z0 + k.solo_usb_z)
    near_x = min(usb_x, key=lambda x: abs(x - solo_usb[0]))
    run = abs(near_x - solo_usb[0]) + abs(port_z - solo_usb[1]) + 2 * 15.0  # two bends
    row("On the Solo", "USB cable slack (cable less plug bodies, less the run between them)",
        k.usb_cable_len - 2 * k.plug_body_len - run, needed=0.0, note=_um("solo_usb_x", "solo_usb_z"))
    if not k.usb_side_agrees:
        row("On the Solo", "usb_side agrees with solo_usb_x", -1, needed=0.0, note="**fix usb_side or solo_usb_x**")

    # ── Lid ──
    row("Lid", "wall tops → lid underside (the lid clamps on the spacers, not the walls)", k.cav_h - k.wall_top,
        needed=0.2, note=_um("pi_board_t"))
    edge = min(min(x - k.out_x0, k.out_x1 - x, y - k.out_y0, k.out_y1 - y) for x, y in k.pi_holes) - k.m2_csk_d / 2
    row("Lid", "screw countersink → lid edge", edge)
    if not k.LID_FEATURES:
        k.make_lid()  # this module's copy of kit hasn't built one yet
    gap, name = min(((k._circle_box_gap(x, y, k.m2_csk_d / 2, b), n) for x, y in k.pi_holes
                     for n, b in k.LID_FEATURES), default=(99.0, "none"))
    row("Lid", f"screw countersink → nearest opening or engraving in the lid ({name})", gap)

    # ── Geometry cross-check with OpenCascade ──
    case_no_bosses = kit.make_case(pi_bosses=False)
    pi = Compound(children=[parts["pi"]["board"], parts["pi"]["metal"], parts["pi"]["black"],
                            parts["pi"]["heatsink"]])
    row("Cross-check (OCC solid distance)", "Pi placeholder → case (less the Pi's own bosses)",
        pi.distance_to(case_no_bosses), note=pi_um)
    row("Cross-check (OCC solid distance)", "Pi placeholder → lid", pi.distance_to(parts["lid"]))
    row("Cross-check (OCC solid distance)", "spacers → case (less the Pi's own bosses)",
        parts["pi"]["spacers"].distance_to(case_no_bosses))
    row("Cross-check (OCC solid distance)", "Solo body → case (the Dual Lock gap)",
        parts["solo"]["body"].distance_to(parts["case"]), note=solo_um)


# ── Printability ────────────────────────────────────────────────────────────

def _seg_dist(pts, a, b):
    """Plan-view distance from each point to segment ab."""
    ab = b - a
    t = np.clip(((pts - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(pts - (a + t[:, None] * ab), axis=1)


def analyse_mesh(mesh: trimesh.Trimesh) -> list[dict]:
    """Ceilings and overhangs past 45°, in print orientation (z up, bed at the lowest z).

    A region's bridge span is twice the furthest any point of it lies from a
    supported edge: an edge whose neighbouring face runs down from it, so
    there is material under the edge to anchor the bridge. A slot in a wall
    is anchored only at its ends; a pocket roof all round.
    """
    n = mesh.face_normals
    z = mesh.triangles[:, :, 2]
    on_bed = np.all(np.abs(z - mesh.bounds[0][2]) < 1e-3, axis=1)
    over = np.degrees(np.arcsin(np.clip(-n[:, 2], -1, 1)))  # 0° a wall, 90° a flat ceiling
    flagged = (over > 45.0 + FACET_SLACK) & ~on_bed
    regions = []
    if not flagged.any():
        return regions
    adj, adj_edges = mesh.face_adjacency, mesh.face_adjacency_edges
    keep = flagged[adj[:, 0]] & flagged[adj[:, 1]]
    groups = trimesh.graph.connected_components(adj[keep], nodes=np.nonzero(flagged)[0], min_len=1)
    centroids = mesh.triangles_center
    for g in groups:
        inside = np.zeros(len(mesh.faces), bool)
        inside[g] = True
        border = inside[adj[:, 0]] ^ inside[adj[:, 1]]
        supported = []
        for (f0, f1), (v0, v1) in zip(adj[border], adj_edges[border]):
            other = f1 if inside[f0] else f0
            a, b = mesh.vertices[v0], mesh.vertices[v1]
            if centroids[other][2] < min(a[2], b[2]) - 1e-3:
                supported.append((a[:2], b[:2]))
        sub_v, sub_f = trimesh.remesh.subdivide_to_size(mesh.vertices, mesh.faces[g], max_edge=0.5)
        pts = np.vstack([sub_v[np.unique(sub_f)][:, :2], sub_v[sub_f].mean(axis=1)[:, :2]])
        if supported:
            d = np.min([_seg_dist(pts, a, b) for a, b in supported], axis=0)
            span = 2 * float(d.max())
        else:
            span = math.inf  # floating: nothing under it at all
        tri = mesh.triangles[g].reshape(-1, 3)
        ext = tri.max(axis=0) - tri.min(axis=0)
        regions.append({"span": span, "footprint": (float(ext[0]), float(ext[1])), "z": float(tri[:, 2].min()),
                        "angle": float(over[g].max()), "area": float(mesh.area_faces[g].sum())})
    regions.sort(key=lambda r: -r["span"])
    return regions


def printability(name: str) -> dict:
    mesh = trimesh.load(kit.OUT / f"{name}.stl")
    return {"name": name, "watertight": mesh.is_watertight, "bodies": len(mesh.split(only_watertight=False)),
            "size": mesh.extents, "volume": mesh.volume, "regions": analyse_mesh(mesh)}


def main(parts) -> None:
    ROWS.clear()
    clearances(parts)
    prints = [printability(n) for n in ("case", "lid", "spacers", "fit_test_pi")]
    (kit.HERE / "REPORT.md").write_text(render_md(prints))
    tight = [r for r in ROWS if r[2] < r[3] - 1e-6]
    bridges = [r for p in prints for r in p["regions"] if r["span"] > 20.0]
    print(f"REPORT.md: {len(ROWS)} clearances, {len(tight)} too tight; "
          f"{sum(len(p['regions']) for p in prints)} flat-ceiling regions, {len(bridges)} over 20 mm")


def _f(v):
    return f"{v:.2f}"


def render_md(prints) -> str:
    k = kit
    out = []
    w = out.append
    tight = [r for r in ROWS if r[2] < r[3] - 1e-6]
    worst = min(ROWS, key=lambda r: r[2] - r[3])
    bridges = [r for p in prints for r in p["regions"] if r["span"] > 20.0]
    steep = [r for p in prints for r in p["regions"] if r["angle"] < 89.0]
    um = k.unmeasured()

    w("# Enclosure report\n")
    w(f"Generated by `kit.py` on {dt.date.today().isoformat()} for **usb_side = {k.usb_side}**, "
      f"**pi_model = {k.pi_model}**. Don't edit it by hand: change a parameter in `kit.py` and run `make`.\n")
    w("## Summary\n")
    w(f"- **Clearances:** {len(ROWS)} checked, "
      + (f"**{len(tight)} under their minimum**." if tight else "none under its minimum.")
      + f" The tightest against its minimum is *{worst[1]}* at {_f(worst[2])} mm (needs {_f(worst[3])}).")
    w(f"- **Printability:** {'no' if not bridges else len(bridges)} bridge over 20 mm, and "
      f"{'no' if not steep else len(steep)} sloping overhang past 45°, across the case, lid, spacers and fit test.")
    if not k.usb_side_agrees:
        w(f"- **⚠ usb_side = {k.usb_side} disagrees with solo_usb_x = {k.solo_usb_x:g}**: the Pi's USB ports face the "
          "wrong end for the Solo's USB-C. Fix one of them.")
    w(f"- **Unmeasured:** {len(um)} dimensions are still published or guessed. Rows that depend on one say so; "
      "see *Measurements still needed*.")
    w(f"- **Size:** the case is {_f(k.out_w)} × {_f(k.out_d)} mm, {_f(k.case_h)} mm to the lid's top"
      + (f" and {_f(k.case_h + k.controls_h)} mm to the fader caps" if k.controls_h else "")
      + f". It sits on the Solo's {k.usb_side} end on {k.dl_mated_t:g} mm of Dual Lock; about "
      f"{k.stack_h:.0f} mm tall all together.\n")

    w("![Isometric](renders/iso.png)\n")
    w("| Case from above, lid off | Case from the rear right |\n|---|---|")
    w("| ![Top](renders/top.png) | ![Case](renders/case.png) |\n")
    w("| Rear | Right side |\n|---|---|")
    w("| ![Rear](renders/rear.png) | ![Right](renders/right.png) |\n")
    w("| Lid from above | Close up |\n|---|---|")
    w("| ![Lid](renders/lid_top.png) | ![Close up](renders/lid.png) |\n")
    w("| Exploded | Underside |\n|---|---|")
    w("| ![Exploded](renders/exploded.png) | ![Underside](renders/bottom.png) |\n")
    w("![Fit test](renders/fit_test.png)\n")

    w("## Clearances\n")
    w(f"All in mm. A row passes at or above its minimum ({_f(k.min_clearance)} unless it says otherwise). "
      "Plan-view rows treat the Pi as a column, because it drops in from above. Rows marked *by design* restate "
      "a parameter; they're listed so nothing is hidden.\n")
    group = None
    for g, item, value, needed, note in ROWS:
        if g != group:
            w(f"\n### {g}\n")
            w("| Check | Clearance | Minimum | Status | Note |\n|---|---:|---:|---|---|")
            group = g
        w(f"| {item} | {_f(value)} | {_f(needed)} | {_status(value, needed, note)} | {note} |")
    w("")

    w("## Printability\n")
    w("Checked on the exported STLs in print orientation. Every downward-facing triangle steeper than 45° "
      f"(plus {FACET_SLACK:g}° for the facets of curved 45° surfaces) "
      "from vertical, other than the bed face, is grouped into regions. A region at 90° is a flat ceiling, "
      "so a bridge. Its span is twice the furthest any point of it lies from a *supported* edge, one with "
      "material running down from it: a slot in a wall counts its full length, a pocket roof its width. "
      "`tests.py` checks this against shapes that should fail.\n")
    w("| Part | Orientation | Size (mm) | Watertight | Bodies | Ceiling regions | Longest bridge | Overhangs past 45° |")
    w("|---|---|---|---|---:|---:|---:|---|")
    orient = {"case": "floor down", "lid": "top up (as fitted)", "spacers": "standing up",
              "fit_test_pi": "plate down"}
    for p in prints:
        sx, sy, sz = p["size"]
        longest = max((r["span"] for r in p["regions"]), default=0.0)
        longest_s = "unsupported" if math.isinf(longest) else f"{_f(longest)} mm"
        slope = [r for r in p["regions"] if r["angle"] < 89.0]
        w(f"| {p['name']} | {orient[p['name']]} | {sx:.1f} × {sy:.1f} × {sz:.1f} | "
          f"{'yes' if p['watertight'] else '**no**'} | {p['bodies']} | {len(p['regions'])} | "
          f"{longest_s} | {'none' if not slope else f'**{len(slope)}**'} |")
    w("")
    for p in prints:
        if p["regions"]:
            over = sum(r["span"] > 20.0 for r in p["regions"])
            w(f"**{p['name']}** ceiling regions ({'all under 20 mm' if not over else f'**{over} over 20 mm**'}):\n")
            w("| Bridge span | Footprint | Height | Area (mm²) |\n|---:|---|---:|---:|")
            for r in p["regions"]:
                fx, fy = r["footprint"]
                w(f"| {_f(r['span'])} | {fx:.1f} × {fy:.1f} | {_f(r['z'])} | {r['area']:.1f} |")
            w("")
    w("Where they come from: the Dual Lock locating grooves under the case are "
      f"{_f(k.dl_groove_d)} mm-deep channels on the bed face, so their roofs bridge {_f(k.dl_groove_w)} mm"
      + (f"; on the lid, each fader cap bridges its {_f(k.fader_slot_w)} mm slot" if k.lid_style != "plain" else "")
      + ". Everything else is a wall, a peaked top, the open-topped rear notch, a through-slot, a 45° chamfer, "
      "or something standing up from the lid's top face. **No part needs supports.**\n")

    w("## Departures from the spec\n")
    w(DEPARTURES.format(k=k, edge=_f(k.edge_overhang), n_side=len(k.side_slots_y), seat=_f(k.cav_h - k.wall_top),
                        notch_drop=_f(k.notch_floor_drop)))

    w("## Measurements still needed\n")
    w("Each is a one-line change in `kit.py`: replace the `est(...)` with the measured number and run `make`.\n")
    w("| Parameter | Current | Where it comes from |\n|---|---:|---|")
    for name, value, note in um:
        w(f"| `{name}` | {value:g} | {note} |")
    w("")

    w("## Hardware\n")
    grams = sum(p["volume"] for p in prints) / 1000 * 1.27  # PETG, as if solid
    w(HARDWARE.format(k=k, grams=grams))
    return "\n".join(out) + "\n"


DEPARTURES = """\
1. **The case rides on top of the Solo** (Gabe's call, 2026-10-07). The spec's tray-under-the-Solo is gone: the
   Solo is the heavier part (382 g against about 100 g), so it sits on its own feet and the Pi rides on top like a
   backpack. That retires the spec's tray, lid pocket, corner posts, the Solo fit test and the accessory points, and
   the Solo dimensions only place the case now. The Pi's heat rises away from the Solo instead of into it.
2. **Dual Lock now, a clip saddle later.** Four 1" 3M Dual Lock squares hold the case on. A clip-on saddle that hooks
   the Solo's bare left and right ends can come once the Solo is here; it will carry the same pads, so the case
   doesn't change. The pads sit in outline grooves rather than recesses: a 25 mm recess roof would be a bridge over
   20 mm.
3. **The Pi's rotation.** The spec places the board with the SD end left, USB end right and power/HDMI edge at the
   rear. No Pi can sit that way: the board is chiral, and with the SD end on the left its power edge is at the
   **front** (official mechanical drawing, RP-008343). The case lies the board front to back: **USB-A and Ethernet
   face the rear**, through an open-topped notch, so the cable drops straight down to the Solo's rear USB-C;
   **power comes in through a peaked window in the right wall**. `usb_side` now only picks which end of the Solo's
   top the case sits on.
4. **The power-edge gap uses the audio jack.** On the Pi 4 the audio barrel stands 2.5 mm proud of the board edge,
   further than the USB-C (1.25). The model keeps `port_gap` from whichever connector on that edge reaches furthest
   ({edge} mm for this build).
5. **The rear jacks reach into the notch.** Their faces stop {k.rear_jack_proud:g} mm inside the rear wall's
   *outside* face, so plugs seat fully and the case stays shallower than the Solo. The notch floor is
   {notch_drop} mm below the board top so the lower plug's body clears it, and the notch runs to the right wall.
6. **Hardware on hand, not heat-set inserts.** One M2 × {k.screw_len:g} screw per corner runs through the lid, a
   printed {k.spacer_len:g} mm spacer tube and the Pi's hole into an M2 nut in a hex pocket in the top of the boss,
   clamping lid, Pi and case together; there's no room for separate lid bosses in a case this tight. The bosses are
   {k.pi_boss_d:g} mm to leave plastic round the nut pocket. The wall tops stop {seat} mm short of the lid, so the
   lid clamps on the spacers and can't rock or bow. The lid is {k.lid_t:g} mm, not 3.0, so its heights fall on
   0.2 mm layers.
   Four D8×3 magnets sit in pockets in the floor, one under each Dual Lock square, ready for the clip saddle.
7. **Vents in the lid and floor** as well as the left wall: the floor slots draw air through the Dual Lock gap, and
   the lid's openings let it out the top. The side vents are vertical slots with 45° peaked tops, not the
   spec's horizontal ones, which would bridge 40 mm.
8. **An SD-card slot** in the front wall, so the card comes out without opening the case.
9. **The fit-test plate** is bigger than 60 × 52: four {k.pi_boss_d:g} mm bosses on a 58 × 49 pattern need about
   69 × 60. It tests the nut pockets and the hole pattern.
10. **The look** (Gabe's ask, 2026-10-07): rounded corners and a rounded lid edge, and with
    `lid_style = "portastudio"` the lid is a cassette 4-track's top panel. Four fader slots (they vent the lid) with scales, caps and channel numbers; four knobs; transport keys (rewind, play, stop, fast-forward,
    record); and a recessed cassette window whose two reel hubs and tape window vent too, with the wordmark on its
    label. It all stands up from, or cuts into, the lid's top face, so it prints without supports.
    `lid_style = "plain"` gives a flat lid with vent slots and the wordmark.
11. **No official Pi 4 STEP exists.** Raspberry Pi publishes STEP models for the Pi 5 only. `assembly.step` carries
    a board-plus-ports placeholder built from the official Pi 4 drawing and DXF.
"""

HARDWARE = """\
| Qty | Part | Used for | Notes |
|---:|---|---|---|
| 4 | M2 × {k.screw_len:g} mm screw, countersunk (flat head) best, pan head works | Lid, spacer and Pi down into the nut | Measured under the head |
| 4 | M2 nut ({k.nut_af:g} mm across the flats) | In the hex pocket on top of each boss | The board covers it, so it can't turn or fall out |
| 4 | Printed spacer tube, {k.spacer_d:g} mm × {k.spacer_len:g} mm (`out/spacers.stl`) | Between the board and the lid | Round, so nothing turns toward the USB-C |
| 4 | D8×3 mm magnet | Floor pockets, for the clip saddle later | All four with the same pole facing down; a drop of glue |
| 4 | 3M Dual Lock square, 1" (25.4 mm), SJ3550 or SJ3560 | Case to the Solo's top, until the saddle | Sticks straight over the magnets |
| 1 | USB-A to USB-C cable, 15–20 cm, a right-angle A end if you can | Pi to Solo | Out of the rear notch and straight down to the Solo's rear USB-C |
| 1 | Official Pi 4 15 W USB-C supply | Power | Through the right-wall window; see the spec's *Power and RAM* |
| 1 | Pi 4 heatsink under 10 mm tall | SoC | `pi_heatsink_top` is its top above the board |
| — | PETG | Case, lid, spacers, fit test | Under {grams:.0f} g (that's if solid; infill uses less). Not PLA |

Spares worth having: a couple of extra M2 nuts; they're small and they roll.
"""


if __name__ == "__main__":
    main(kit.build())
