"""PNG previews of the enclosure, rendered off-screen with PyVista.

Run through kit.py (`make`), which passes it the built parts.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pyvista as pv
from build123d import export_stl

import kit

RENDERS = kit.HERE / "renders"
SIZE = (1400, 1000)

TRAY = "#e6dcc4"
LID = "#40444c"  # a charcoal lid on a cream case reads like a Portastudio
BOARD = "#2f7d43"
METAL = "#b8b8b8"
BLACK = "#222222"
SINK = "#8d93a0"
SOLO = "#c0392b"


def _mesh(shape, tmp: Path, name: str) -> pv.PolyData:
    path = tmp / f"{name}.stl"
    export_stl(shape, path, tolerance=0.02, angular_tolerance=0.2)
    return pv.read(path)


def _add(plotter, mesh, color, opacity=1.0, edges=True):
    plotter.add_mesh(mesh, color=color, opacity=opacity, smooth_shading=False,
                     specular=0.15, ambient=0.25)
    if edges:
        r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
        line = "#d9d2c3" if 0.3 * r + 0.59 * g + 0.11 * b < 110 else "#3a3a3a"
        plotter.add_mesh(mesh.extract_feature_edges(35, boundary_edges=False, non_manifold_edges=False),
                         color=line, line_width=1.2, opacity=min(1.0, opacity + 0.3))


def _plotter(title: str) -> pv.Plotter:
    p = pv.Plotter(off_screen=True, window_size=SIZE)
    p.set_background("#fbfaf7")
    p.enable_anti_aliasing("ssaa")
    p.add_text(title, position="upper_left", font_size=12, color="#333333")
    return p


def _scene(meshes, which, offsets=None):
    """[(mesh, color, opacity)] for the named groups, each optionally raised."""
    offsets = offsets or {}
    out = []
    for group in which:
        dz = offsets.get(group, 0.0)
        for mesh, color, opacity in meshes[group]:
            out.append((mesh.translate((0, 0, dz), inplace=False), color, opacity))
    return out


def _shoot(scene, title, cam, path, parallel=False, zoom=1.0):
    p = _plotter(title)
    for mesh, color, opacity in scene:
        _add(p, mesh, color, opacity)
    p.camera_position = cam
    if parallel:
        p.enable_parallel_projection()
    p.reset_camera()
    p.camera.zoom(zoom)
    p.screenshot(path)
    p.close()


def main(parts: dict) -> None:
    RENDERS.mkdir(exist_ok=True)
    for old in RENDERS.glob("*.png"):
        old.unlink()
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        pi, solo = parts["pi"], parts["solo"]
        m = {
            "case": [(_mesh(parts["case"], tmp, "case"), TRAY, 1.0)],
            "lid": [(_mesh(parts["lid"], tmp, "lid"), LID, 1.0)],
            "pi": [(_mesh(pi["board"], tmp, "board"), BOARD, 1.0),
                   (_mesh(pi["metal"], tmp, "metal"), METAL, 1.0),
                   (_mesh(pi["black"], tmp, "black"), BLACK, 1.0),
                   (_mesh(pi["heatsink"], tmp, "sink"), SINK, 1.0),
                   (_mesh(pi["spacers"], tmp, "spacers"), TRAY, 1.0)],
            "solo": [(_mesh(solo["body"], tmp, "solo"), SOLO, 1.0),
                     (_mesh(solo["feet"], tmp, "feet"), BLACK, 1.0),
                     (_mesh(solo["jacks"], tmp, "jacks"), BLACK, 1.0),
                     (_mesh(solo["dual_lock"], tmp, "dl"), BLACK, 1.0)],
        }
        fit = [(_mesh(kit.print_pose(parts["fit_test_pi"]), tmp, "fp"), LID, 1.0)]
        case_print = [(_mesh(kit.print_pose(parts["case"]), tmp, "cp"), TRAY, 1.0)]

    cx, cy = kit.solo_x0 + kit.solo_w / 2, kit.solo_y0 + kit.solo_d / 2
    zc = kit.solo_body_z0 + kit.stack_h / 2
    kx, ky = kit.cav_w / 2, kit.cav_d / 2
    side = f"usb_side={kit.usb_side}, Pi {kit.pi_model}"
    everything = ["case", "lid", "pi", "solo"]

    _shoot(_scene(m, everything), f"Isometric (front-left), {side}. The Solo is a placeholder",
           [(cx - 260, cy - 330, zc + 220), (cx, cy, zc), (0, 0, 1)], RENDERS / "iso.png")
    _shoot(_scene(m, ["case", "pi"]), f"Case from above, lid off ({side}). Front is at the bottom",
           [(kx, ky, 500), (kx, ky, 0), (0, 1, 0)], RENDERS / "top.png", parallel=True, zoom=1.1)
    _shoot(_scene(m, everything), f"Rear ({side}). Viewer's left is the box's right",
           [(cx, cy + 600, zc), (cx, cy, zc), (0, 0, 1)], RENDERS / "rear.png", parallel=True, zoom=1.1)
    _shoot(_scene(m, everything), f"Right side ({side}). Front is on the left",
           [(cx + 600, cy, zc), (cx, cy, zc), (0, 0, 1)], RENDERS / "right.png", parallel=True, zoom=1.1)
    _shoot(_scene(m, everything, {"pi": 30, "lid": 75, "case": 0, "solo": -40}), f"Exploded ({side})",
           [(cx + 320, cy - 360, zc + 260), (cx + 20, cy, zc + 10), (0, 0, 1)], RENDERS / "exploded.png")
    _shoot(_scene(m, ["case", "pi"]), f"Case and Pi from the rear right ({side})",
           [(kx + 170, ky + 190, 160), (kx, ky, 8), (0, 0, 1)], RENDERS / "case.png")
    lid_only = _scene(m, ["lid"])
    _shoot(lid_only, "Lid from above: faders, knobs, transport keys and the cassette (front at the bottom)",
           [(kx, ky, 500), (kx, ky, 0), (0, 1, 0)], RENDERS / "lid_top.png", parallel=True, zoom=1.15)
    _shoot(_scene(m, ["case", "lid", "pi"]), f"Close up, front left ({side})",
           [(kx - 120, ky - 150, 170), (kx, ky - 5, 20), (0, 0, 1)], RENDERS / "lid.png")
    _shoot(case_print, "Case underside: floor vents and the Dual Lock pad grooves",
           [(0, -60, -240), (0, 0, 0), (0, 1, 0)], RENDERS / "bottom.png")
    _shoot(fit, "Fit test in print orientation: the Pi's four bosses and nut pockets",
           [(40, -130, 150), (0, 0, 0), (0, 0, 1)], RENDERS / "fit_test.png")
    print(f"renders → {RENDERS.relative_to(kit.HERE)}/")
