# Printing and assembling the enclosure

Everything in `out/` is exported **already in print orientation**, sitting on the bed at z = 0. Import it into
the slicer and don't rotate it. No part needs supports. [REPORT.md](REPORT.md) has the check: the longest
bridge is a foot-recess roof at about 10.6 mm, and nothing overhangs past 45°.

## What to print, and when

| Order | File | When | Time (rough) | Checks |
|---:|---|---|---|---|
| 1 | `out/fit_test_pi.stl` | **Now** | 25 min | The M2.5 insert bore, the Pi's hole pattern, and an M3 insert on the tab |
| 2 | `out/tray.stl` | **Now**, once the fit test passes | 4–5 h | The Pi drops in, screws down, and every port lines up with its opening |
| 3 | `out/fit_test_solo.stl` | When the Solo arrives and is measured | 15 min | The Solo drops between the posts with no force and no rattle |
| 4 | `out/lid.stl` | After the Solo fit test passes | 2–3 h | |

`out/fit_test.stl` is both fit-test halves on one bed, with the plate inside the ring, for later reprints.

The tray's outside size follows the Solo's published width and depth, which haven't been measured yet. Printing it
now proves the Pi end of things, since the Pi is placed from the right and rear walls. If the real Solo comes in
more than about 1 mm off the published 143 × 96 mm, reprint the tray with the lid so the outlines still match.

## Slicer settings (PETG)

| Setting | Value |
|---|---|
| Layer height | 0.2 mm |
| Walls / perimeters | 4 (the 2.4 mm walls are then solid) |
| Top and bottom layers | 4 |
| Infill | 20% gyroid |
| Supports | **Off** |
| Nozzle | 230–245 °C (the spool's range wins) |
| Bed | 75–85 °C, textured PEI or glue stick on smooth PEI (PETG can bond too well to bare smooth PEI) |
| Part cooling | 30–50% (more for the bridges if your slicer has a separate bridge fan setting) |
| Elephant-foot compensation | 0.1–0.2 mm, so the first layer doesn't shrink the foot recesses |
| Seam | Rear, or aligned |
| Brim | Not needed. Add a 5 mm brim to the tray if your corners lift |

**Orientation:** the tray prints floor-down; the lid deck-down, posts up; the fit-test plate and ring flat. They
come out of `out/` that way.

Two details the slicer might query:
- The **side vents and the power window** have 45° peaked tops. They print as plain walls, not bridges.
- The **accessory insert holes** are teardrop-shaped (pointed at the top) so they print round enough without
  support. The insert's knurl fills the point.

## Setting the heat-set inserts

You need a soldering iron with a heat-set insert tip (or an old conical tip). Brass inserts (CNC Kitchen, Ruthex
and similar) take the bores in the model: M2.5 × 4 mm long into a 3.6 mm hole, M3 × 5.7 mm long into a 4.0 mm
hole. If your inserts' maker gives a different hole size, change `insert_m25_bore` or `insert_m3_bore` in
`kit.py` and re-run `make`.

1. Let the print cool fully. Set the iron to **about 230 °C** for PETG.
2. Sit the insert on the hole, **narrow end down** (most inserts taper). Put the tip in the insert.
3. Let it heat for 3–5 seconds, then press **straight down with light pressure**. Let the heat do the work. If you
   have to push hard, wait longer.
4. Stop when the insert is about 0.5 mm proud of the surface. Lift the iron straight out; don't wiggle it.
5. While the plastic is still soft, press the insert flush with something flat and cold: a steel ruler, or the flat
   of a screwdriver. That squares it up and makes it **flush**, which matters here:
   - **Pi bosses:** a proud insert tilts the board and throws the ports off their openings.
   - **Lid bosses:** a proud insert holds the lid off the wall top.
6. Give it a minute before screwing into it.

**The accessory inserts** go in from the outside of the side wall, horizontally. Lay the tray on its side, so
you're still pressing straight down. Nothing uses them yet, so you can skip them.

**If an insert goes wrong:** heat it again and pull it out with pliers. Then either reprint the boss on the fit
test with a corrected bore, or fill the hole with a slightly bigger insert.

## The fit tests

### Pi half (now)

1. Print `fit_test_pi.stl`. Set the four M2.5 inserts and the one M3 insert (on the tab).
2. Lay the Pi on the four bosses. **All four holes should line up** with the inserts without pushing the board.
3. Screw it down with four M2.5 × 6 mm screws. Each should bite firmly and stop with the head snug.
4. Tune what you found in `kit.py`, then `make`:
   - **The insert spins or pulls out:** take 0.1 off `insert_m25_bore` (or `insert_m3_bore`).
   - **The insert bulged the boss or needed real force:** add 0.1.
   - **The holes don't line up:** tell Claude. The pattern comes from the official drawing, so that would be news.
5. The engraved line on the plate says which bores it was printed with.

### Solo half (later)

1. Print `fit_test_solo.stl` after measuring the Solo.
2. The Solo should drop between the four posts **by its own weight**, and shouldn't rattle when you nudge it.
   - **It rattles:** take 0.1–0.2 off `fit`.
   - **It binds:** add 0.1–0.2 to `fit`.
3. Check the posts don't block the XLR plug or anything on the front face.

## Assembly

1. **Tray:** set the four M2.5 inserts in the Pi bosses and the four M3 inserts at the wall top.
2. **Pi:** put the SD card in (it's at the front end, with the lid off). Lower the Pi in from above: the USB-A and
   Ethernet jacks go to the rear notch, and the USB-C power to the window in the right wall. Screw it down with
   four M2.5 × 6.
3. **Check the ports** before closing up: plug the power supply in through the side window and a USB-A cable
   through the rear notch. Both should go fully home without touching the plastic.
4. **Feet:** stick the four bumpers in the round recesses underneath.
5. **Lid:** four M3 × 8 countersunk screws into the wall-top inserts. Their heads sit flush, so the Solo sits flat
   on them.
6. **Solo:** drop it between the posts, front face forward. Run the USB-A cable from the Pi's rear USB port up to the
   Solo's rear USB-C.

To get at the Pi later: lift the Solo off, take out the four lid screws, lift the lid.

## After printing, measure and report

[REPORT.md](REPORT.md) lists every dimension that's still published or guessed. The ones that matter now, with
the Pi on hand:

- `pi_usb_overhang`: how far the USB-A and Ethernet jacks stick out past the board edge.
- `pi_audio_overhang` and `pi_usbc_overhang`: the same for the audio jack and the USB-C on the long edge.
- `pi_heatsink_top`: the heatsink's top above the board's top face, once it's stuck on.
- `pi_tallest`: the USB-A stack's top above the board's top face.

Each is a one-line change in `kit.py`, then `make`.
