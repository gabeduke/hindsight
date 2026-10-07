# Hindsight kit enclosure: spec

Copied on 2026-10-07 from the Jamstation project doc
`claude/2026-10-07-kit-build-spec.md`, sections "Bill of materials" and
"The enclosure", so this folder carries its own spec. The text below is the
source as written. Where the model deliberately departs from it, the reason
is in [REPORT.md](REPORT.md) under "Departures from the spec".

## Revision, 2026-10-07: the Pi rides on top

After the first model, Gabe changed the concept:

- **The Pi goes on top of the Solo**, like a backpack, since the Solo is the
  heavier part. The Solo sits on its own feet; nothing is printed under it.
- **Attachment:** 3M Dual Lock now. A clip-on saddle that hooks the Solo's
  bare ends comes later, once the Solo is measured, and carries the same pads.
- **Look:** rounded edges, and a lid styled like a cassette 4-track (a
  Portastudio's top panel).

So the parts are now a Pi **case** (base), its **lid**, and the Pi fit-test
plate. The spec's tray, Solo pocket, corner posts, Solo fit-test ring and
accessory points below no longer apply; its Pi numbers, port rules, insert
sizes, print settings and thermal rules still do. The Jamstation project doc
still describes the original concept.

---

## Bill of materials

| Item | Notes |
|---|---|
| Scarlett Solo 4th Gen | Ordered. 143 × 96 × 46.5 mm, 382 g, bus-powered at 900 mA |
| Raspberry Pi 4B | The spare. Check its RAM with `free -h`, since it sets `RING_SECONDS` |
| Official Pi 4 power supply, 15 W (5.1 V 3 A) | See *Power and RAM* below |
| microSD, 32–64 GB, A2, high-endurance | Takes run about 11.5 MB a minute (mono, 48 kHz, 32-bit), so 64 GB is roughly 90 hours |
| USB-A to USB-C cable, about 15–20 cm | USB 2.0 is fine. A right-angle A end tidies the corner |
| Pi 4 heatsink (a stick-on set, or an aluminium case-style one under 10 mm tall) | |
| 4 × M2.5 heat-set inserts plus 4 × M2.5 × 6 mm screws | Pi mounting |
| 4 × M3 heat-set inserts plus 4 × M3 × 8 mm countersunk screws | Lid to tray |
| 4 × adhesive rubber bumpers, about 10 mm | Feet |
| PETG filament | Not PLA: the Pi warms the box |

### Power and RAM

- **Power:** the Solo draws up to **900 mA** from USB. The Pi 4's USB ports share a **1.2 A** budget, so it fits with the official 15 W supply. Use the official supply, not a phone charger, because the Bluebird's phantom power comes out of that budget. ([The Pi Hut](https://support.thepihut.com/hc/en-us/articles/360015272218-How-much-current-can-I-draw-from-a-Raspberry-Pi-USB-port)) A Pi 5 would need its 27 W supply, since it caps USB at 600 mA on a 3 A supply. ([Raspberry Pi whitepaper](https://pip-assets.raspberrypi.com/categories/685-app-notes-guides-whitepapers/documents/RP-009856-WP-1-USB%20Power%20delivery%20on%20Raspberry%20Pi%205.pdf))
- **RAM:** the ring holds `seconds × 48000 × channels × 4 bytes`, and a full save briefly doubles it. With the Solo's 4 capture channels:

  | Pi 4 RAM | `RING_SECONDS` | Ring | Peak during a save |
  |---|---|---|---|
  | 4 or 8 GB | 900 (15 min) | 691 MB | about 1.4 GB |
  | 2 GB | 600 (10 min) | 461 MB | about 0.9 GB |
  | 1 GB | 300 (5 min) | 230 MB | about 0.5 GB |

- Turning the tape on adds 23 MB a minute of loaded clips. On a 2 GB Pi, also shorten `TAPE_LENGTH_S`.

## The enclosure

### Concept

```
        ┌───────────────────────────┐
        │     Scarlett Solo         │  ← sits in a shallow pocket, front and back faces clear
   ┌────┴───────────────────────────┴────┐  ← LID: flat deck plus low corner posts
   │  TRAY: Pi on bosses, rear-right     │  ← TRAY: floor, walls, port windows, vents
   └─────────────────────────────────────┘
          ▲ rubber feet
```

There are two printed parts, and neither needs supports:

1. **Tray.** A floor and four walls, open at the top. The Pi screws to four bosses on the floor. Port windows are in the walls.
2. **Lid.** A flat deck that screws onto the tray, with low corner posts on top that hold the Solo in place. It prints deck-down, posts up.

To service the box, lift the Solo off, remove four screws and lift the lid, and the Pi is exposed. That makes the tray the "sled."

### Constraints from the Solo

From the [Solo 4th Gen user guide](https://fael-downloads-prod.focusrite.com/customer/prod/downloads/scarlett_solo_4th_gen_user_guide_v4-pdf-en.pdf):

- **Front face:** every control is here. Input 1 gain, Input 1 ¼" jack, Inst, Input 2 gain, 48V, Air, the speaker level knob, the USB LED, Direct Monitor, headphone level and the headphone ¼" jack. **Nothing may cover the front face** above the deck.
- **Rear face, left to right as viewed from the rear:** Kensington slot, **USB-C**, speaker outs R and L, **XLR Input 2 (the Bluebird)**. **Nothing may cover the rear face** either. The XLR plug and its cable bend need clear space behind the box.
- **Top:** no controls. It stays clear for a phone dock later.
- **Bottom:** rubber feet. Measure their height; they rest on the deck.
- From the front, the guide's rear order suggests the **USB-C is near the right end** and the XLR near the left. **Confirm this on the unit**, since it decides which side the Pi's USB ports face (parameter `usb_side`).

### Dimensions to measure before modeling

The published numbers are below. Measure the real parts with calipers, and **where they disagree, the calipers win**. The CAD script must keep these as named parameters at the top.

| Parameter | Published value | Measure |
|---|---|---|
| `solo_w` × `solo_d` × `solo_h` | 143 × 96 × 46.5 | Overall body, including any lip or radius |
| `solo_foot_h` | — | Height of the bottom feet |
| `solo_usb_x` | — | Centre of the rear USB-C, from the body's left end (seen from the front) |
| `solo_xlr_z` | — | Height of the XLR's lowest point above the feet |
| `solo_front_low_z` | — | Lowest edge of any front knob skirt or jack |
| Pi 4B board | 85 × 56 × ~1.5 | |
| Pi mounting holes | Ø2.7, 58 × 49 pattern, 3.5 from the edges | |
| Pi rear-edge ports, from the SD-card end | USB-C 11.2 (both); micro-HDMI 25.8 and 39.2 on the Pi 5, 26 and 39.5 on the Pi 4; audio 54 on the Pi 4 only | |
| `pi_usb_overhang` | about 3 | How far the USB-A and Ethernet jacks overhang the board edge |
| `pi_tallest` | about 16 | The USB-A stack height above the board. Also measure the heatsink top |

Pi 5 numbers are from the [Raspberry Pi 5 mechanical drawing](https://datasheets.raspberrypi.com/rpi5/raspberry-pi-5-mechanical-drawing.pdf). Raspberry Pi also publishes [mechanical drawings and models](https://pip.raspberrypi.com/categories/559-mechanical). If a STEP model of the board is available, import it in the assembly for clearance checks.

### Layout

Coordinates are in mm. The origin is at the **inside front-left corner of the tray cavity, at floor level**. X runs left to right (seen from the front), Y runs front to back, and Z runs up.

| Parameter | Default | Derived |
|---|---|---|
| `fit` (clearance per side) | 0.6 | |
| `wall` | 2.4 | 6 perimeters at 0.4 |
| `floor_t` | 2.4 | |
| `lid_t` | 3.0 | |
| Cavity | | `solo_w + 2·fit` × `solo_d + 2·fit` = **144.2 × 97.2** |
| Tray outside | | **149.0 × 102.0** |
| `cav_h` (cavity height) | 28 | Board top at 6.5, which leaves about 5.5 above the tallest part as an air gap |
| `standoff_h` | 5 | |
| Base height without feet | | 2.4 + 28 + 3 = **33.4** |
| Overall with the Solo | | about **80** |

The tray and lid outsides match the Solo pocket, so the whole stack is a single 149 × 102 footprint.

**Pi placement (`usb_side = right`, the default)**
- The Pi sits in the **rear-right** of the cavity, long axis along X.
- Its USB-A and Ethernet end faces the **right wall**, and its USB-C power and HDMI edge faces the **rear wall**.
- Port faces stop **0.5 mm short** of the inside wall, so the Pi drops straight in from above and plugs go in through the windows.
- Board extent: X 55.7–140.7, Y 39.2–95.2.
- Hole centres: (59.2, 42.7), (117.2, 42.7), (59.2, 91.7), (117.2, 91.7).
- That leaves about 55 mm free on the left and 39 mm free at the front of the cavity, for cable slack, a later NVMe or SSD board, or a fan.
- **Check the board's rotation** against the real Pi: the SD-card end is on the left (low X), and the power and HDMI edge is at high Y.
- With `usb_side = left`, mirror the layout in X.

**Rear wall**
- **One window, for the Pi's USB-C power only**, centred at X 66.9 (69.3 from the outside left), about 13 × 8 mm.
- No HDMI windows: the kit is headless, and you can lift the lid to plug in a screen.
- Give the window a 45° peaked top so it prints without a bridge.

**Right wall**
- **One notch over the USB-A and Ethernet stacks**, about 54 mm wide (the board's Y span less 1 mm) and running from 0.5 below the board top (Z 6.0) up to the top of the wall. The lid closes it from above.
- The band left open above the jacks doubles as the main exhaust vent.
- The notch has to cover both stacks: the Pi 4 and Pi 5 put USB and Ethernet in a different order, and one wide notch fits both.

**Floor**
- Four bosses for the Pi: 6.5 mm across, 5 mm tall, sized for **M2.5 heat-set inserts**. Make the bore diameter a parameter (`insert_m25_bore`, default 3.6) and check it against the insert maker's spec.
- A grid of vent slots under the Pi's footprint: 2 × 20 mm slots on a 4 mm pitch.
- Four 1 mm recesses for the feet near the corners.

**Left wall**
- Vent slots: three horizontal 2 × 40 mm slots, 4 mm pitch, at mid-height. With the right-wall notch, they give a cross-flow.

**Front wall**
- Plain. It sits below the Solo's controls. An embossed "hindsight" wordmark is optional.

**Lid fixing**
- Four M3 heat-set-insert bosses on the tray, about 7 mm across, running up to the wall top.
- **They can't go in the rear-right corner**, because the Pi is there (the board reaches X 140.7, Y 95.2).
- Place them at the front-left corner, front-right corner, rear-left corner, and on the rear wall at X about 45, left of the Pi.
- The lid has matching countersunk M3 holes, so the screw heads sit flush under the Solo.

**Lid top: the Solo pocket**
- Four L-shaped corner posts, each `post_h` = 8 mm tall, with legs `post_leg` = 12 mm along each face, 3 mm thick.
- Their inside faces sit `fit` (0.6 mm) from the Solo body. Add a 0.8 mm chamfer at the top inside edges so the Solo drops in.
- Keep `post_h` below `solo_xlr_z` and `solo_front_low_z`, the lowest point of any knob or jack on the faces, less 2 mm. If a post blocks the XLR plug or the Input 1 gain knob, shorten that leg.
- Optional: 0.5 mm-deep recesses for the Solo's feet, which stop it sliding without any fastener.

**Accessory points (for later)**
- Two M3 heat-set inserts on the outside of each side wall, 60 mm apart, at mid-height.
- Nothing uses them yet. They're for the phone wing or a cable clip later.

**Cable**
- The Pi's USB-A comes out through the right-wall notch and turns the rear-right corner. A 15–20 cm cable goes up into the Solo's rear USB-C.
- Power enters through the rear window.
- Nothing crosses the front.

**Thermal**
- With no tape, Hindsight is a light load.
- The deck under the Solo is solid, so the Pi's heat doesn't cook the Solo's underside.
- Air enters through the floor slots, which the feet raise, and leaves through the right notch and the left slots.
- Keep at least 5 mm between the heatsink top and the lid. If the heatsink is taller than the USB stack, raise `cav_h`. The model keeps `pi_model` (`4`/`5`) as a parameter, so a Pi 5 build later only changes the clearance check and the cooler headroom.

### Print settings

- **PETG**, 0.2 mm layers, 4 walls, 4 top and bottom layers, 20% gyroid infill.
- **Tray:** print floor-down. **Lid:** print deck-down, posts up. **Neither needs supports.** Every window has either a peaked top or an open top.
- Run a **fit test first** (about 20 minutes): a 2 mm-tall slice of the lid's corner posts, to check the Solo's fit, plus a 60 × 52 plate with the four Pi bosses, to check the Pi and inserts. Adjust `fit` and `insert_m25_bore`, then print the real parts.

### Modeling it in code

**Use build123d** (Python, on the same OpenCascade kernel as CadQuery):
- It exports **STEP** as well as STL, so Fusion 360, Bambu Studio or PrusaSlicer can open the result and Gabe can hand-tweak it later if he wants.
- It can import a STEP model of the Pi for an interference check.
- It does real fillets and chamfers.
- Claude Code can run it headless and render PNG previews to check its own work.

OpenSCAD with BOSL2 is the fallback. It's simpler and its CLI renders PNGs directly, but it doesn't do STEP or easy fillets. A Fusion 360 MCP setup needs Fusion running on the Mac with an add-in. It's possible, but it's the least repeatable loop for someone who doesn't want to model by hand.

### Done when

- The fit test passes: the Solo drops in with no rattle and no force, and the Pi's screws bite the inserts.
- Assembled, the Solo's front and rear connectors and controls are all reachable with plugs in. Check the XLR, the headphones and the Input 1 jack specifically.
- A 1-hour capture with the lid on keeps the Pi at or below 70 °C (`vcgencmd measure_temp`).
