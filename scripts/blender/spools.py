# The turning parts, rendered: the bar's reels and the cassette's hubs, as
# sheets of frames for lib/objects/spin.js to turn.
#
#   /Applications/Blender.app/Contents/MacOS/Blender --background \
#     --factory-startup --python scripts/blender/spools.py
#
# writes web/static/sprites/reel.webp and hub.webp, then prints each one's
# address. Put those in spin.js (REEL.src, HUB.src) and sw.js's SHELL:
# spin.test.js fails until the ?v= is the file's own hash. Encoding needs
# cwebp (`brew install webp`); Blender's own WebP keeps alpha lossless and
# comes out twice the size. --factory-startup keeps a Blender you have open,
# and its add-ons, out of it.
#
# Each sheet is one turn of the part's symmetry -- 120 degrees for a reel's
# three windows, 60 for a hub's six teeth -- with the part drawn turned a
# step further in each cell, clockwise. The lamp stays where it is, so the
# highlights hold still while the metal turns under them, as on a real reel:
# what a flat drawing turned by a transform can't do. Every cell is rendered
# at once, in one picture: sun lamps, a world and an orthographic camera
# light each copy alike wherever it stands.
#
# The sizes and the cell order are spin.js's REEL and HUB. Change one, change
# the other: spin.test.js reads the sheets' sizes back.
#
# The reel is the bar's (reel-window.js): a flange 74 across in a 160 box,
# three windows 21 across, 42 out, the first straight up; a black hub 15
# across. The hub is the cassette's (cassette.js): a 44 box, the spool 20
# across. The colours are the materials' (objects.css: --reel-*, --hub*).

import bpy
import bmesh
import hashlib
import math
import os
import shutil
import subprocess
import sys
import tempfile
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'static', 'sprites')
SAMPLES = 128

# The sheets, as spin.js reads them. A set is (first cell, cells, blur):
# the blur is how far the part turns while the shutter is open, in degrees.
REEL = dict(cell=160, px=160, cols=4, rows=5, period=120,
            sets=[(0, 12, 0), (12, 4, 36), (16, 1, 120)])
HUB = dict(cell=44, px=96, cols=6, rows=2, period=60,
           sets=[(0, 12, 0)])


def linear(hex_):
    """An sRGB hex colour as Blender's linear RGBA."""
    c = [int(hex_.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)


def stage():
    """An empty scene set up for a sheet: Cycles, a clear film, no tone curve."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # The blurred cells turn between two keys; linear, so evenly.
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.seed = 1
    sc.render.film_transparent = True
    # Standard, not AgX: a material's colour comes out as the token it is.
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.resolution_percentage = 100
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = 2.0
    sc.render.motion_blur_position = 'CENTER'

    # The room as the metal sees it: dark below, the lamp-lit ceiling above.
    w = bpy.data.worlds.new('room')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    coord = nt.nodes.new('ShaderNodeTexCoord')
    xyz = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(coord.outputs['Generated'], xyz.inputs[0])
    nt.links.new(xyz.outputs['Z'], ramp.inputs[0])
    nt.links.new(ramp.outputs['Color'], nt.nodes['Background'].inputs['Color'])
    ramp.color_ramp.elements[0].color = (0.05, 0.045, 0.04, 1)
    ramp.color_ramp.elements[1].color = (0.75, 0.72, 0.68, 1)
    return sc


def sun(sc, toward, energy, angle):
    """A sun lamp shining from `toward` (x right, y up, z at the camera)."""
    lamp = bpy.data.lights.new('sun', 'SUN')
    lamp.energy = energy
    lamp.angle = math.radians(angle)
    ob = bpy.data.objects.new('sun', lamp)
    ob.rotation_euler = (-Vector(toward)).normalized().to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(ob)


def lamps(sc, key):
    # The room's lamp is upper left (lib/room/space.js), and so is this one.
    sun(sc, (-1.0, 1.1, 1.5), key, 12)
    sun(sc, (1.0, -0.6, 1.2), key * 0.18, 30)


def material(name, colour, metallic=0.0, rough=0.4, brushed=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = colour
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = rough
    p.inputs['Coat Weight'].default_value = coat
    if brushed:
        # Turned on a lathe: the grain runs round the axis, so the lamp makes
        # a bow tie across the face that stays put as the reel turns.
        p.inputs['Anisotropic'].default_value = brushed
        t = nt.nodes.new('ShaderNodeTangent')
        t.direction_type = 'RADIAL'
        t.axis = 'Z'
        nt.links.new(t.outputs['Tangent'], p.inputs['Tangent'])
    return m


def circle(r, n=160, cx=0.0, cy=0.0):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def polar(r, deg):
    return r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg))


def slab(name, loops, depth, bevel, mat, z=0.0):
    """A flat part: closed outlines (a loop inside another is a hole), given
    `depth` and its edges rounded by `bevel`, its middle at `z`."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    cu.extrude = depth / 2
    cu.bevel_depth = bevel
    cu.bevel_resolution = 3
    for loop in loops:
        sp = cu.splines.new('POLY')
        sp.points.add(len(loop) - 1)
        for i, (x, y) in enumerate(loop):
            sp.points[i].co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    tmp = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(tmp)
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(tmp)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(30))
    me.transform(Matrix.Translation((0, 0, z)))
    me.materials.append(mat)
    return me


def dome(name, r, h, mat, x, y, z):
    """A rivet's head: a flattened half sphere."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=r)
    for v in bm.verts:
        v.co.z = max(v.co.z, 0) * h / r
        v.co += Vector((x, y, z))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.materials.append(mat)
    return me


def render(sc, spec, parts, path):
    """Every cell of `spec` in one picture: a copy of `parts` per cell, each
    turned to its cell's angle, the blurred ones turning through it."""
    cell, cols, rows = spec['cell'], spec['cols'], spec['rows']
    cam = bpy.data.cameras.new('camera')
    cam.type = 'ORTHO'
    cam.sensor_fit = 'HORIZONTAL'
    cam.ortho_scale = cols * cell
    cam.clip_end = 2000
    eye = bpy.data.objects.new('camera', cam)
    eye.location = (cols * cell / 2, -rows * cell / 2, 500)
    sc.collection.objects.link(eye)
    sc.camera = eye
    sc.render.resolution_x = cols * spec['px']
    sc.render.resolution_y = rows * spec['px']

    for first, n, blur in spec['sets']:
        for k in range(n):
            i = first + k
            root = bpy.data.objects.new(f'cell-{i}', None)
            root.location = ((i % cols + 0.5) * cell, -(i // cols + 0.5) * cell, 0)
            sc.collection.objects.link(root)
            for me in parts:
                ob = bpy.data.objects.new(me.name, me)
                ob.parent = root
                sc.collection.objects.link(ob)
            # Clockwise on the screen is negative about z, the camera's axis.
            turn = -math.radians(k * spec['period'] / n)
            if blur:
                half = math.radians(blur) / 2
                root.rotation_euler.z = turn + half
                root.keyframe_insert('rotation_euler', index=2, frame=1)
                root.rotation_euler.z = turn - half
                root.keyframe_insert('rotation_euler', index=2, frame=3)
            else:
                root.rotation_euler.z = turn
    sc.frame_set(2)  # the shutter, open from frame 1 to 3, centred here
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def reel(path):
    sc = stage()
    alu = material('aluminium', linear('#c4c7cb'), metallic=1.0, rough=0.26, brushed=0.75)
    black = material('hub', linear('#17181a'), rough=0.32, coat=0.4)
    steel = material('steel', linear('#8a8d92'), metallic=1.0, rough=0.2)
    shadow = material('shadow', linear('#0b0b0c'), rough=0.6)
    windows = [circle(21, 96, *polar(42, a)) for a in (90, -30, 210)]
    # The spindle hole and the three slots its keys go in.
    hole = []
    for i in range(120):
        a = 2 * math.pi * i / 120
        slot = any(abs((a - math.radians(90 + 120 * k) + math.pi) % (2 * math.pi) - math.pi) < 0.32 for k in range(3))
        r = 7.2 if slot else 4.6
        hole.append((r * math.cos(a), r * math.sin(a)))
    parts = [
        slab('flange', [circle(73.2, 256)] + windows, 1.4, 0.7, alu),
        slab('rib', [circle(67.6, 256), circle(66.0, 256)], 0.6, 0.45, alu, z=0.9),
        slab('hub', [circle(15.2), hole], 3.2, 0.8, black, z=2.4),
        slab('spindle', [circle(4.4, 64)], 4, 0.6, steel, z=0.6),
        slab('well', [circle(8, 64)], 0.4, 0.1, shadow, z=-0.6),
    ] + [dome(f'rivet-{k}', 2.5, 1.2, steel, *polar(24, a), 0.7) for k, a in enumerate((30, 150, 270))]
    lamps(sc, 3.2)
    render(sc, REEL, parts, path)


def hub(path):
    sc = stage()
    plastic = material('plastic', linear('#efe9d8'), rough=0.38, coat=0.15)
    core = material('core', linear('#1a1b1d'), rough=0.7)
    teeth = []
    for k in range(6):
        c, s = math.cos(math.radians(90 + 60 * k)), math.sin(math.radians(90 + 60 * k))
        tooth = [(6.6, -1.3), (11, -1.3), (11, 1.3), (6.6, 1.3)]
        teeth.append(slab(f'tooth-{k}', [[(x * c - y * s, x * s + y * c) for x, y in tooth]], 2.6, 0.35, plastic, z=0.2))
    parts = [
        slab('spool', [circle(20), circle(10, 120)], 3.0, 0.7, plastic),
        slab('collar', [circle(13.4, 120), circle(10, 120)], 1.4, 0.45, plastic, z=1.6),
        slab('core', [circle(11, 96)], 0.4, 0.1, core, z=-3),
    ] + teeth
    lamps(sc, 1.9)
    render(sc, HUB, parts, path)


def encode(png, webp):
    """The sheet as WebP: lossy, alpha too -- the edges' alpha is most of it."""
    cwebp = shutil.which('cwebp') or ('/opt/homebrew/bin/cwebp' if os.path.exists('/opt/homebrew/bin/cwebp') else None)
    if not cwebp:
        sys.exit('spools.py: cwebp not found (brew install webp)')
    subprocess.run([cwebp, '-quiet', '-q', '80', '-alpha_q', '70', '-m', '6', png, '-o', webp], check=True)
    with open(webp, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()[:8]
    return f'/sprites/{os.path.basename(webp)}?v={digest}'


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix='spools-')
    addresses = []
    for name, make in (('reel', reel), ('hub', hub)):
        png = os.path.join(tmp, f'{name}.png')
        make(png)
        addresses.append(encode(png, os.path.join(OUT, f'{name}.webp')))
    shutil.rmtree(tmp)
    print('\n'.join(['', 'spools.py wrote:'] + addresses))


main()
