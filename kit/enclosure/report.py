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

    # ── The Pi to the walls ──
    for wall in ("front", "rear", "left", "right"):
        nearest = min(k.pi_keepout, key=lambda b: _wall_gap(b, wall))
        gap = _wall_gap(nearest, wall)
        note = pi_um
        if wall == k.usb_wall:
            note = (note + "; " if note else "") + "jack faces, by design (port_gap); plugs go in through the notch"
        elif wall == k.pwr_wall:
            note = (note + "; " if note else "") + "the edge connector that reaches furthest, by design (port_gap)"
        row("The Pi to the walls", f"{wall} wall ← {nearest.name}", gap, note=note)

    # ── The Pi to the bosses and pads (plan view: the Pi drops in from above) ──
    for name, (x, y) in k.lid_screws.items():
        row("The Pi to the bosses", f"lid boss, {name}", k.pi_gap_2d(x, y, k.lid_boss_d / 2), note=pi_um)
    for side, u in k.accessory:
        x0 = 0.0 if side == "left" else k.cav_w - k.acc_pad_depth
        pad = k.Box3("pad", x0, x0 + k.acc_pad_depth, u - k.acc_pad_w / 2, u + k.acc_pad_w / 2, 0, k.cav_h)
        gap = min(max(b.x0 - pad.x1, pad.x0 - b.x1, b.y0 - pad.y1, pad.y0 - b.y1) for b in k.pi_keepout)
        row("The Pi to the bosses", f"accessory pad, {side} wall at Y {u:.1f}", gap, note=pi_um)

    # ── Up and down ──
    top = max(b.z1 for b in k.pi_keepout if b.name not in ("heatsink",))
    row("The Pi, up and down", "tallest jack top → lid underside", k.cav_h - top, note=_um("pi_tallest"))
    row("The Pi, up and down", "heatsink top → lid underside (spec: 5 mm for airflow)",
        k.cav_h - (k.board_top_z + k.pi_heatsink_top), needed=5.0, note=_um("pi_heatsink_top"))
    row("The Pi, up and down", "board underside parts → floor", k.board_bot_z - k.pi_underside)

    # ── Port faces to their openings ──
    usbc = next(b for b in k.pi_keepout if b.name == "USB-C power")
    u0, u1 = sorted((k.wall_u(k.pwr_wall, usbc.x0, usbc.y0), k.wall_u(k.pwr_wall, usbc.x1, usbc.y1)))
    w0, w1 = k.pwr_u - k.pwr_win_w / 2, k.pwr_u + k.pwr_win_w / 2
    row("Port faces to openings", "USB-C receptacle → window sides", min(u0 - w0, w1 - u1), note=pi_um)
    row("Port faces to openings", "USB-C receptacle → window bottom", usbc.z0 - k.pwr_win_z0)
    row("Port faces to openings", "USB-C plug body → window sides", (k.pwr_win_w - k.pwr_plug_w) / 2,
        note=_um("pwr_plug_w"))
    row("Port faces to openings", "USB-C plug body → window bottom/top", (k.pwr_win_h - k.pwr_plug_h) / 2,
        note=_um("pwr_plug_h"))
    jacks = [b for b in k.pi_keepout if b.name in [p[0] for p in k.end_ports]]
    for j in jacks:
        a0, a1 = sorted((k.wall_u(k.usb_wall, j.x0, j.y0), k.wall_u(k.usb_wall, j.x1, j.y1)))
        row("Port faces to openings", f"{j.name} jack → notch sides", min(a0 - k.notch_u0, k.notch_u1 - a1),
            note=pi_um)
    row("Port faces to openings", "jack bottoms → notch floor", k.board_top_z - k.notch_z0,
        note="`notch_floor_drop`, by design")
    plug_bot = k.board_top_z + k.usb_low_port_zc - k.usb_plug_h / 2
    row("Port faces to openings", "lower USB-A plug body → notch floor", plug_bot - k.notch_z0,
        note=_um("usb_low_port_zc", "usb_plug_h"))
    usb_centres = sorted((k.wall_u(k.usb_wall, (j.x0 + j.x1) / 2, (j.y0 + j.y1) / 2)) for j in jacks
                         if j.name.startswith("USB"))
    outer = min(usb_centres[0] - k.notch_u0, k.notch_u1 - usb_centres[-1])
    row("Port faces to openings", "USB-A plug body → notch side (outer stack)", outer - k.usb_plug_w / 2,
        note=_um("usb_plug_w"))

    # ── The Solo and its posts ──
    row("The Solo and the posts", "Solo body → post inside faces", k.fit,
        note="`fit`, by design; " + _um("solo_w", "solo_d"))
    low = min(k.solo_xlr_z, k.solo_front_low_z)
    row("The Solo and the posts", "post top → lowest XLR or front jack/knob, less 2 (spec)", low - 2 - k.post_h,
        needed=0.0, note=_um("solo_xlr_z", "solo_front_low_z"))
    leg_start = k.solo_w - k.post_leg  # Solo-frame X where the rear-right leg begins
    plug_end = k.solo_usb_x + k.solo_usb_plug_w / 2
    if k.usb_side == "left":
        leg_start, plug_end = k.post_leg, k.solo_usb_x - k.solo_usb_plug_w / 2
        gap = plug_end - leg_start
    else:
        gap = leg_start - plug_end
    row("The Solo and the posts", f"Solo USB-C plug → rear-{k.usb_side} post leg (sideways)", gap,
        note=_um("solo_usb_x", "solo_usb_plug_w"))

    # ── Lid screws ──
    for name, (x, y) in k.lid_screws.items():
        r = k.m3_csk_d / 2
        gaps = []
        for c in kit.CORNERS:
            # Each post is two rectangles: test the circle against both legs
            ox = 0 if "left" in c else k.cav_w
            oy = 0 if "front" in c else k.cav_d
            sx = -1 if "left" in c else 1
            sy = -1 if "front" in c else 1
            L, t = k.post_leg + k.fit, k.post_t
            legs = [(ox - sx * L, ox + sx * t, oy, oy + sy * t), (ox, ox + sx * t, oy - sy * L, oy + sy * t)]
            for ax, bx, ay, by in legs:
                b = k.Box3("leg", min(ax, bx), max(ax, bx), min(ay, by), max(ay, by), 0, 0)
                gaps.append(kit._circle_box_gap(x, y, r, b))
        row("Lid screws", f"countersink, {name} → nearest post", min(gaps))
        edge = min(x + k.wall, k.cav_w + k.wall - x, y + k.wall, k.cav_d + k.wall - y) - r
        row("Lid screws", f"countersink, {name} → lid edge", edge)

    # ── Geometry cross-check with OpenCascade ──
    tray_no_bosses = kit.make_tray(pi_bosses=False)
    pi = Compound(children=[parts["pi"]["board"], parts["pi"]["metal"], parts["pi"]["black"],
                            parts["pi"]["heatsink"]])
    row("Cross-check (OCC solid distance)", "Pi placeholder → tray (less the Pi's own bosses)",
        pi.distance_to(tray_no_bosses), note=pi_um)
    row("Cross-check (OCC solid distance)", "Pi placeholder → lid", pi.distance_to(parts["lid"]))
    row("Cross-check (OCC solid distance)", "Solo body → lid posts", parts["solo"]["body"].distance_to(parts["lid"]),
        note=_um("solo_w", "solo_d"))


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
    flagged = (over > 45.0 + 0.5) & ~on_bed
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
    prints = [printability(n) for n in ("tray", "lid", "fit_test_pi", "fit_test_solo")]
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
      f"{'no' if not steep else len(steep)} sloping overhang past 45°, across the tray, lid and both fit-test halves.")
    if not k.usb_side_agrees:
        w(f"- **⚠ usb_side = {k.usb_side} disagrees with solo_usb_x = {k.solo_usb_x:g}**: the Pi's USB ports face the "
          "wrong end for the Solo's USB-C. Fix one of them.")
    w(f"- **Unmeasured:** {len(um)} dimensions are still published or guessed. Rows that depend on one say so; "
      "see *Measurements still needed*.")
    w(f"- **Size:** {_f(k.out_w)} × {_f(k.out_d)} mm footprint; base {_f(k.base_h)} mm tall without feet; "
      f"about {k.stack_h:.0f} mm with the Solo on top.\n")

    w("![Isometric](renders/iso.png)\n")
    w("| Top, lid off | Tray from the rear right |\n|---|---|")
    w("| ![Top](renders/top.png) | ![Tray](renders/tray.png) |\n")
    w("| Rear | Right side |\n|---|---|")
    w("| ![Rear](renders/rear.png) | ![Right](renders/right.png) |\n")
    w("| Exploded | Fit test |\n|---|---|")
    w("| ![Exploded](renders/exploded.png) | ![Fit test](renders/fit_test.png) |\n")

    w("## Clearances\n")
    w(f"All in mm. A row passes at or above its minimum ({_f(k.min_clearance)} unless it says otherwise). "
      "Plan-view rows treat the Pi as a column, because it drops in from above.\n")
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
      "from vertical, other than the bed face, is grouped into regions. A region at 90° is a flat ceiling, "
      "so a bridge. Its span is twice the furthest any point of it lies from a *supported* edge, one with "
      "material running down from it: a slot in a wall counts its full length, a pocket roof its width. "
      "`tests.py` checks this against shapes that should fail.\n")
    w("| Part | Orientation | Size (mm) | Watertight | Bodies | Ceiling regions | Longest bridge | Overhangs past 45° |")
    w("|---|---|---|---|---:|---:|---:|---|")
    orient = {"tray": "floor down", "lid": "deck down, posts up", "fit_test_pi": "plate down",
              "fit_test_solo": "ring down"}
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
    w("Where they come from: the four foot recesses under the tray are 1 mm-deep pockets on the bed face, "
      f"so their roofs bridge {_f(k.foot_recess_d)} mm. Everything else is a wall, a peaked top, an open-topped "
      "notch, a 45° pad underside, a teardrop bore or an upward-facing countersink. **No part needs supports.**\n")

    w("## Departures from the spec\n")
    w(DEPARTURES.format(k=k, edge=_f(k.edge_overhang), pwr_u=_f(k.pwr_u),
                        acc_drop=", ".join(f"{s} wall at Y {u:.1f} ({why})" for s, u, why in k.accessory_dropped)
                        or "none",
                        wall_screw=", ".join(k.wall_screw_names) or "none",
                        post_over=_f(3.0 - k.wall), n_side=len(k.side_slots_u),
                        pwr_wall=k.pwr_wall, usb_wall=k.usb_wall, vent_wall=k.vent_wall,
                        notch_drop=_f(k.notch_floor_drop)))

    w("## Measurements still needed\n")
    w("Each is a one-line change in `kit.py`: replace the `est(...)` with the measured number and run `make`.\n")
    w("| Parameter | Current | Where it comes from |\n|---|---:|---|")
    for name, value, note in um:
        w(f"| `{name}` | {value:g} | {note} |")
    w("")

    w("## Hardware\n")
    grams = sum(p["volume"] for p in prints) / 1000 * 1.27  # PETG, as if solid
    w(HARDWARE.format(k=k, n_lid=len(k.lid_screws), n_acc=len(k.accessory),
                      n_m3=len(k.lid_screws) + len(k.accessory), grams=grams,
                      m25_depth=k.insert_m25_len + 1, m25_bite=6 - k.pi_board_t,
                      m3_depth=k.insert_m3_len + 1, m3_bite=8 - k.lid_t,
                      usb_wall=k.usb_wall, pwr_wall=k.pwr_wall))
    return "\n".join(out) + "\n"


DEPARTURES = """\
1. **The Pi's rotation.** The spec's default layout puts the SD-card end on the left, the USB end on the right and
   the power/HDMI edge at the rear. No Pi can sit that way: the board is chiral. Seen from above with the SD end on
   the left, its power/HDMI edge is at the **front** (official mechanical drawing, RP-008343). So the model rotates
   the board instead of mirroring it:
   - `usb_side = right`: the board's long axis runs front to back against the right wall. **USB-A and Ethernet face
     the rear wall**, through an open-topped notch, so the cable to the Solo's rear USB-C is a short hop straight up.
     **USB-C power enters through a peaked window in the right wall.**
   - `usb_side = left`: the spec's layout mirrored, which is a real rotation. USB-A and Ethernet face the left wall,
     and power enters through the rear wall.

   This build: USB-A/Ethernet out of the **{usb_wall}** wall, power in through the **{pwr_wall}** wall, the window
   centred {pwr_u} mm along it from the cavity's inside corner.
2. **The power-edge gap uses the audio jack.** On the Pi 4 the audio barrel stands 2.5 mm proud of the board edge,
   further than the USB-C (1.25). The spec's board extent left 2.0 mm, which would push the barrel into the wall. The
   model keeps `port_gap` from whichever connector on that edge reaches furthest ({edge} mm for this build).
3. **Lid screws.** Corner screws sit {k.lid_screw_inset:g} mm in from the outside edges, not tight in the corner,
   so their countersinks clear the Solo posts above them. The corner the Pi occupies is dropped, and a boss on the
   rear wall beside the Pi replaces it: {wall_screw}.
4. **Post thickness** is `wall` ({k.wall:g} mm), not 3 mm. With the inside faces `fit` from the Solo, a 3 mm post
   would hang {post_over} mm past the 149 × 102 footprint.
5. **Side vents are vertical.** Three horizontal 2 × 40 mm slots would leave 40 mm bridges over their tops. The model
   uses {n_side} vertical 2 × {k.side_slot_h:g} mm slots with 45° peaked tops across the same 40 mm, in the
   {vent_wall} wall, across the Pi from the power edge, for the spec's cross-flow.
6. **The fit-test plate** is bigger than 60 × 52: four 6.5 mm bosses on a 58 × 49 pattern need about 68 × 60. It
   also carries one M3 lid-insert boss on a tab, so you can practise that insert too. The Solo half is a thin ring
   with a {k.fit_post_slice_h:g} mm slice of each post on it.
7. **Accessory points.** Each insert sits in a pad inside the wall with a 45° underside and a teardrop bore, so it
   prints without support. Pads the Pi or a port opening would hit are left out: {acc_drop}. Nothing uses them yet.
8. **No official Pi 4 STEP exists.** Raspberry Pi publishes STEP models for the Pi 5 only. `assembly.step` carries
   a board-plus-ports placeholder built from the official Pi 4 drawing and DXF.
9. **The notch floor is lower and the notch runs into the corner.** The spec puts the notch floor 0.5 mm below the
   board top. The model drops it {notch_drop} mm, so a USB-A plug in the lower port clears it; and where the Pi
   took a corner from the lid screws, the notch runs on into that corner, so the outer plug has room sideways.
10. **No wordmark** on the front wall (optional in the spec). Engraving on a vertical face adds many small ceilings.
"""

HARDWARE = """\
| Qty | Part | Used for | Notes |
|---:|---|---|---|
| 4 | M2.5 heat-set insert, {k.insert_m25_len:g} mm long | Pi bosses | Bore {k.insert_m25_bore:g} mm, {m25_depth:g} mm deep. Check the maker's hole size |
| 4 | M2.5 × 6 mm screw, pan or cap head | Pi to bosses | Through the {k.pi_board_t:g} mm board leaves {m25_bite:g} mm in the insert |
| {n_m3} | M3 heat-set insert, {k.insert_m3_len:g} mm long | {n_lid} lid bosses + {n_acc} accessory points | Bore {k.insert_m3_bore:g} mm, {m3_depth:g} mm deep |
| {n_lid} | M3 × 8 mm countersunk screw (ISO 10642 / DIN 7991) | Lid to tray | Head sits flush in a {k.m3_csk_d:g} mm countersink; {m3_bite:g} mm in the insert |
| 4 | Adhesive rubber bumper, about 10 mm across | Feet | In {k.foot_recess_d:g} mm × {k.foot_recess_t:g} mm recesses |
| 1 | USB-A to USB-C cable, 15–20 cm, a right-angle A end if you can | Pi to Solo | Out of the {usb_wall} notch, up to the Solo's rear USB-C |
| 1 | Official Pi 4 15 W USB-C supply | Power | Through the {pwr_wall}-wall window; see the spec's *Power and RAM* |
| 1 | Pi 4 heatsink under 10 mm tall | SoC | `pi_heatsink_top` is its top above the board |
| — | PETG | All four prints | Under {grams:.0f} g (that's if solid; 4 walls and 20% infill use less). Not PLA |

Spares worth having: two extra of each insert, for the fit test and a botched one. The fit test uses 4 × M2.5 and
1 × M3 insert of its own.
"""


if __name__ == "__main__":
    main(kit.build())
