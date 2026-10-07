# Printing and assembling the Pi case

The Pi rides on top of the Solo in a small case, held on with 3M Dual Lock for now and by magnets on a clip saddle
later. Its lid looks like the top panel of a cassette 4-track. It all goes together with M2 screws and nuts, and
needs no heat-set inserts or soldering iron.

Everything in `out/` is exported **already in print orientation**, sitting on the bed at z = 0. Import it into the
slicer and don't rotate it. No part needs supports. [REPORT.md](REPORT.md) has the check: the longest bridge is a
magnet pocket's 8 mm roof, and nothing overhangs past 45°.

## What to print, and when

| Order | File | When | Time (rough) | Checks |
|---:|---|---|---|---|
| 1 | `out/fit_test_pi.stl` | **Now** | 20 min | The M2 nut pockets and the Pi's hole pattern |
| 2 | `out/case.stl` | **Now**, once the fit test passes **and the Pi is measured** (below) | 2–3 h | The Pi drops in, and every port lines up with its opening |
| 3 | `out/lid.stl` | Now | 1 h | |
| 4 | `out/spacers.stl` | Now | 15 min | Four tubes, printed standing up |

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
- `pi_tallest`: the USB-A stack's top above the board's top face (the lid sits 18 mm above the board).
- `pi_heatsink_top`: the heatsink's top above the board's top face, once it's stuck on.
- `pi_board_t`: the board's thickness. The 25 mm screws only just reach the nuts, so this one counts.

Each is a one-line change, then `make`.

## Slicer settings (PETG)

| Setting | Value |
|---|---|
| Layer height | 0.2 mm |
| Walls / perimeters | 4; the slicer gap-fills the rest of the 2.4 mm walls. 6 at 0.4 mm makes them fully solid |
| Top and bottom layers | 4 |
| Infill | 20% gyroid (100% for the spacers, which are only tubes anyway) |
| Supports | **Off** |
| Nozzle | 230–245 °C (the spool's range wins) |
| Bed | 75–85 °C, textured PEI or glue stick on smooth PEI (PETG can bond too well to bare smooth PEI) |
| Part cooling | 30–50% |
| Elephant-foot compensation | 0.1–0.2 mm, so the first layer doesn't close the Dual Lock grooves or the magnet pockets |
| Seam | Rear, or aligned |

**Orientation:** the case prints floor-down; the lid flat, its controls facing up; the spacers standing up; the
fit-test plate flat. They come out of `out/` that way. The side vents, the power window and the SD slot have 45°
peaked tops, and the case's bottom edge is a 45° chamfer, so none of them needs support.

**Colour:** the renders show a cream case and a charcoal lid, which reads like a Portastudio. For two-tone
controls, add a filament change in the slicer at **2.4 mm**, the first layer of the controls.

## The fit test

1. Print `fit_test_pi.stl`.
2. Drop an M2 nut into each boss's hex pocket. It should sit flat and not turn; a light press is fine.
3. Lay the Pi on the bosses. **All four holes should line up** over the nuts without pushing the board.
4. Run an M2 screw through each hole into its nut. It should catch straight away and pull the board down flat.
5. Tune `kit.py`, then `make`:
   - **The nut turns in its pocket:** take 0.1 off `nut_fit`.
   - **The nut won't go in:** add 0.1 to `nut_fit`.
   - **The holes don't line up:** tell Claude. The pattern comes from the official drawing, so that would be news.
6. The engraved line on the plate says which pocket size it was printed with.

## Magnets

The case has four 8 mm pockets in its underside, one in the middle of each Dual Lock outline, for the clip saddle
that comes later. Fit the magnets now or later:

1. Decide which pole faces down, and mark it. **All four case magnets go the same way up.** The saddle's magnets go
   the other way up, so each pair attracts.
2. Put a drop of superglue in each pocket and press the magnet in flush. Wipe off any squeeze-out.
3. Until the saddle exists, the Dual Lock squares stick straight over them.

## Assembly

1. **Nuts:** drop an M2 nut into the hex pocket on top of each of the four bosses.
2. **Pi:** put the SD card in, then lower the Pi in from above with its USB-A and Ethernet jacks to the rear. They
   drop into the open notch in the back wall, the USB-C power lines up with the window in the right wall, and the
   board covers the nuts.
3. **Spacers:** stand a spacer tube on each of the Pi's mounting holes.
4. **Check the ports** before closing up: the power supply through the side window, a USB-A cable into the rear
   jacks. Both should seat fully without touching the plastic. The power socket sits about 4 mm inside the wall, so
   the plug's body has to go into the window: if your supply's plug is bigger than 12 × 7 mm, measure it and set
   `pwr_plug_w`/`pwr_plug_h`. A right-angle USB-A plug should bend **up** or sideways; one that bends down meets the
   notch's sill.
5. **Lid:** lay it on the spacers. Channel 1 is at the front left and the cassette at the back. Run an M2 × 25 screw
   down through each corner hole, through the spacer and the board, into the nut. Snug, not tight: the same four
   screws hold the Pi and the lid. A countersunk head sits flush; a pan head sits on top.
6. **Dual Lock:** press each pair of 1" squares together, peel one backing, and stick them on the case's underside
   inside the four groove outlines (over the magnets, if they're in). Clean the Solo's top with isopropyl alcohol,
   peel the other backings, and press the case onto the end of the Solo's top that its USB-C is on (the right, by
   default), its rear face in line with the Solo's rear face. Press hard for 30 seconds, and leave it an hour
   before pulling on it.
7. **Cables:** a short USB-A to USB-C cable from the Pi's rear USB port straight down to the Solo's rear USB-C, and
   the power supply into the case's right side.

**The SD card** comes out through the slot in the front wall without opening the case. Its tip sits just inside
the wall, so use a fingernail or tweezers.

**To get at the Pi:** take out the four lid screws and lift the lid and spacers off; the case can stay on the Solo.
The Pi is then loose on its bosses and lifts straight out. To take the case off the Solo, pull it straight up,
firmly and evenly: Dual Lock lets go and goes back together.

## Later: the clip saddle

Once the Solo is here and measured, a clip-on saddle can hook its bare left and right ends, so no adhesive touches
the Solo. It will carry four magnets that meet the ones in the case floor, so the Pi lifts off the Solo and clicks
back on, and this case doesn't change.
