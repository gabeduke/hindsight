# Printing and assembling the Pi case

The Pi rides on top of the Solo in a small case, held on with 3M Dual Lock. Its lid looks like the top panel of
a cassette 4-track. Everything in `out/` is exported **already in print orientation**, sitting on the bed at
z = 0. Import it into the slicer and don't rotate it. No part needs supports. [REPORT.md](REPORT.md) has the
check: the longest bridge is a fader cap crossing its 2.4 mm slot, and nothing overhangs past 45°.

## What to print, and when

| Order | File | When | Time (rough) | Checks |
|---:|---|---|---|---|
| 1 | `out/fit_test_pi.stl` | **Now** | 20 min | The M2.5 insert bore and the Pi's hole pattern |
| 2 | `out/case.stl` | **Now**, once the fit test passes **and the Pi is measured** (below) | 2–3 h | The Pi drops in, and every port lines up with its opening |
| 3 | `out/lid.stl` | Now | 1 h | |

Nothing here waits for the Solo. Its size only decides where the case sits on its top, and REPORT.md checks that
the case doesn't overhang the Solo's front face. The clip saddle, a later part, is the one that needs the Solo
measured.

## Measure the Pi before printing the case

The Pi sits 0.5 mm from the right wall, set by the audio jack's barrel, which the model takes from the official
drawing (2.5 mm). If the real barrel stands proud by more than 3 mm, the Pi won't drop in. The SD card's tip sits
0.5 mm from the front wall the same way. Two minutes with calipers saves a reprint. In `kit.py`:

- `pi_audio_overhang` and `pi_usbc_overhang`: how far the audio jack and the USB-C stick out past the board's long
  edge.
- `pi_usb_overhang`: how far the USB-A and Ethernet jacks stick out past the short edge.
- `pi_sd_protrude`: how far an inserted SD card sticks out past the other short edge.
- `pi_tallest`: the USB-A stack's top above the board's top face (the lid sits 20 mm above the board).
- `pi_heatsink_top`: the heatsink's top above the board's top face, once it's stuck on.

Each is a one-line change, then `make`.

## Slicer settings (PETG)

| Setting | Value |
|---|---|
| Layer height | 0.2 mm |
| Walls / perimeters | 4; the slicer gap-fills the rest of the 2.4 mm walls. 6 at 0.4 mm makes them fully solid |
| Top and bottom layers | 4 |
| Infill | 20% gyroid |
| Supports | **Off** |
| Nozzle | 230–245 °C (the spool's range wins) |
| Bed | 75–85 °C, textured PEI or glue stick on smooth PEI (PETG can bond too well to bare smooth PEI) |
| Part cooling | 30–50% |
| Elephant-foot compensation | 0.1–0.2 mm, so the first layer doesn't close the Dual Lock grooves |
| Seam | Rear, or aligned |

**Orientation:** the case prints floor-down; the lid flat, its controls facing up; the fit-test plate flat. They
come out of `out/` that way. The side vents, the power window and the SD slot have 45° peaked tops, and the case's
bottom edge is a 45° chamfer, so none of them needs support.

**Colour:** the renders show a cream case and a charcoal lid, which reads like a Portastudio. For two-tone
controls, add a filament change in the slicer at the lid's **first layer above 2.5 mm**. The faders, knobs and keys then come
out in the second colour, and the engraved scales and cassette stay in the first.

## Setting the heat-set inserts

You need a soldering iron with a heat-set insert tip (or an old conical tip). The bores suit brass M2.5 inserts
4 mm long (CNC Kitchen, Ruthex and similar) in a 3.6 mm hole. If your inserts' maker gives a different hole size,
change `insert_m25_bore` in `kit.py` and run `make`.

1. Let the print cool fully. Set the iron to **about 230 °C** for PETG.
2. Sit the insert on the hole, **narrow end down** (most inserts taper). Put the tip in the insert.
3. Let it heat for 3–5 seconds, then press **straight down with light pressure**. Let the heat do the work. If you
   have to push hard, wait longer.
4. Stop when the insert is about 0.5 mm proud. Lift the iron straight out; don't wiggle it.
5. While the plastic is still soft, press the insert **flush** with something flat and cold, like a steel ruler. A
   proud insert tilts the board and throws its ports off their openings.
6. Give it a minute before screwing into it.

**If an insert goes wrong:** heat it again, pull it out with pliers, and reprint the fit test with a corrected bore.

## The fit test

1. Print `fit_test_pi.stl` and set its four inserts.
2. Lay the Pi on the bosses. **All four holes should line up** without pushing the board.
3. Screw in four M2.5 standoffs (their male threads go through the board into the inserts). Each should bite
   firmly and pull the board down flat.
4. Tune `kit.py`, then `make`:
   - **The insert spins or pulls out:** take 0.1 off `insert_m25_bore`.
   - **The insert bulged the boss or needed real force:** add 0.1.
   - **A boss split:** set `pi_boss_d` to 7.0. A 6.5 mm boss leaves only about 1.5 mm of plastic round the insert.
   - **The holes don't line up:** tell Claude. The pattern comes from the official drawing, so that would be news.
5. The engraved line on the plate says which bore it was printed with.

## Assembly

1. **Case:** set the four M2.5 inserts in the bosses.
2. **Pi:** put the SD card in, then lower the Pi in from above with its USB-A and Ethernet jacks to the rear. They
   drop into the open notch in the back wall, and the USB-C power lines up with the window in the right wall.
3. **Standoffs:** screw four M2.5 × 20 mm male-female standoffs through the Pi's holes into the inserts. Snug is
   enough. **On the one beside the USB-C socket (front right), stop with a flat of the hex facing the socket**,
   not a corner: flat-on it clears by 0.87 mm, corner-on by 0.49.
4. **Check the ports** before closing up: the power supply through the side window, a USB-A cable into the rear
   jacks. Both should seat fully without touching the plastic.
5. **Lid:** four M2.5 × 6 mm countersunk screws through the lid into the standoffs. Channel 1 is at the front
   left, and the cassette is at the back.
6. **Dual Lock:** press each pair of 1" squares together, peel one backing, and stick them on the case's underside
   inside the four groove outlines. Clean the Solo's top with isopropyl alcohol, peel the other backings, and
   press the case onto the Solo's right end, its rear face in line with the Solo's rear face. Press hard for 30
   seconds, and leave it an hour before pulling on it, longer if you can.
7. **Cables:** a short USB-A to USB-C cable from the Pi's rear USB port straight down to the Solo's rear USB-C, and
   the power supply into the case's right side.

**The SD card** comes out through the slot in the front wall without opening the case. Its tip sits just inside
the wall, so use a fingernail or tweezers.

**To get at the Pi:** peel the case off the Dual Lock (it lets go with a firm, even pull), then take out the four
lid screws.

## Later: the clip saddle

Once the Solo is here and measured, a clip-on saddle can hook its bare left and right ends, so no adhesive touches
the Solo. It will carry the same Dual Lock squares on its top, so this case doesn't change.
