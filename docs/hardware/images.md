# Hardware image references

Where to find pictures of the rig's devices, for the rig page's device cards
and for diagrams. **These are references, not copies.** The repo is public and
the pictures belong to their makers, so nothing is downloaded into it. Each
profile in `internal/rig/profiles/` lists the ids below under
`hardware.images`, and `internal/rig/hardware_test.go` fails if an id there is
missing from this file.

## How these were gathered

- Each URL was read off the maker's own product or guide page. None was
  downloaded or rendered when this was written, so **what a picture shows is
  inferred** from its file name, alt text or the callouts around it. Where a
  page labelled nothing, the view says *not labelled*. Look before you rely on
  one.
- A URL can change when a maker redesigns a page. If one 404s, search the
  page named in *Page* and update the row.
- Some URLs are a sized or cropped **rendition**: Zoom's end in
  `.jpg.800x482_q70_crop…` and Focusrite's in `/stencil/300w/`. The full-size
  original is probably the same address with that part removed or enlarged.
  That is a guess: try it before building on it.

## Licensing, and what to build from these

- Treat every image as all rights reserved. **Link to it; don't commit it.**
- A drawing made *from* a photo (a jack's position, a panel's proportions) is
  fine as long as it is redrawn, not traced into a lookalike: the rig's cards
  should be Hindsight's own objects in its own materials (see
  `web/static/objects.css`), which is also what the design wants.
- **The best image of your own unit is a photo you take of it.** It can be
  committed, it shows the exact revision, and it needs no licence. Shoot each
  device straight-on from the front, the top and the back, in even light, with
  a ruler or a coin in frame for scale. Put them under `docs/hardware/photos/`
  and add rows here with the status *own photo*.

## Extending these into drawings later

Not built, and not needed for the profiles to work. When a device card is
drawn from a picture, the natural shape is a `hardware.art` block in the
device's profile: the id of a panel drawing, and for each port id an `[x, y]`
anchor on it. The cable ropes already take their ends from socket positions
(`docs/development.md`), so an anchor is all a drawing has to supply.

## Focusrite Scarlett Solo 4th Gen

Page: <https://us.focusrite.com/products/scarlett-solo>

| Id | View | URL |
|---|---|---|
| `scarlett-solo-front` | Front | <https://cdn11.bigcommerce.com/s-7exlzlf13h/images/stencil/300w/products/304/791/Scarlett-Solo-Front-Image-2400-x-2400__87504.1711664540.jpg?c=3> |
| `scarlett-solo-rear` | Rear | <https://cdn11.bigcommerce.com/s-7exlzlf13h/images/stencil/300w/products/304/792/Scarlett-Solo-Rear-Image-2400-x-2400__84471.1711664540.jpg?c=3> |
| `scarlett-solo-front-elevated` | Elevated front (from the file name) | <https://cdn11.bigcommerce.com/s-7exlzlf13h/images/stencil/300w/products/304/790/Scarlett-Solo-Front-elevated-2400-x-2400-compressed2__84938.1711664540.png?c=3> |

The file names say 2400 × 2400, and these links are the 300-wide rendition.
The page also has a three-quarter left view (`Scarlett-Solo-3quart-Left`),
not recorded here because its full address wasn't read.

## Zoom R20

Page: <https://zoomcorp.com/en/us/digital-mixer-multi-track-recorders/multi-track-recorders/r20/>
· Manual (has its own numbered diagrams): <https://zoomcorp.com/manuals/r20-en/>

All under `https://zoomcorp.com/media/original_images/`; the file names below
are the ones on the page, with the crop suffix left off.

| Id | View | File |
|---|---|---|
| `r20-hero` | Main product shot, angle not labelled | `Hero_3-2.png` |
| `r20-top` | Top | `R20_top_2.jpg` |
| `r20-slant` | Angled, with background | `R20_slant_1-2.jpg` |
| `r20-side` | Side | `R20_side_2.jpg` |
| `r20-rear` | Rear (connectors) | `R20_rear_tOS7DVl.jpg` |
| `r20-sd` | SD card slot | `R20_SD_3.jpg` |
| `r20-touchscreen` | Touchscreen close-up | `touchscreen_inset_3.jpg` |
| `r20-tour-diagram` | Numbered diagram of inputs, controls and ports | `Tour_v1_ZEqLKxf.png` |

`r20-touchscreen` and `r20-top` are the two the
[theme brief](zoom-r20-theme-brief.md) needs first. Zoom's site also blocks
direct PDF downloads from some networks; the HTML manual is the reliable copy.

## 1010music Bento

Page: <https://1010music.com/product/bento>

All under `https://1010music.com/wp-content/uploads/2025/05/`. The page
labels no view on any of them.

| Id | View | File |
|---|---|---|
| `bento-main` | Main image, not labelled | `1010Music_BentoBox_01B.jpg` |
| `bento-01` | Not labelled | `1010Music_BentoBox_01.jpg` |
| `bento-02` | Not labelled | `1010Music_BentoBox_02.jpg` |
| `bento-03` | Not labelled | `1010Music_BentoBox_03.jpg` |
| `bento-04` | Not labelled | `1010Music_BentoBox_04.jpg` |
| `bento-05` | Not labelled | `1010Music_BentoBox_05.jpg` |
| `bento-06a` | Not labelled | `1010Music_BentoBox_06A.jpg` |
| `bento-07b` | Not labelled | `1010Music_BentoBox_07B.jpg` |
| `bento-prism-tracks` | Screen, in use | `bento-prism-tracks2-web-res.jpeg` |
| `bento-gran-hands` | Screen, in use | `bento-gran-bothhands.jpeg` |
| `bento-vesa` | Mounted on a VESA bracket | `bento-vesa-modularbg1V2.jpeg` |

The three in-use pictures are named for the Bento's screens (Prism, Gran) and
a mount; their subjects are from the file names.

## Akai MPC Sample

Page: <https://www.akaipro.com/guides/mpc-sample/features.htm>

| Id | View | URL |
|---|---|---|
| `mpc-sample-ports` | Ports and connections, with callouts (inferred from the callout list) | <https://www.akaipro.com/guides/mpc-sample/drex_features_screen.png> |
| `mpc-sample-top` | Top panel: display, speaker, knobs, fader, buttons, pads, with callouts (inferred) | <https://www.akaipro.com/guides/mpc-sample/drex_features_screen_2.png> |

Both carry Akai's callout labels over the picture, which is useful for knowing
what each control is called and not for use as art.

## M-VAVE SMK-37 Elite

Page: <https://www.m-vave.com/product.html?id=smk-37-elite>

| Id | View | Source |
|---|---|---|
| `smk-37-elite-own-photo` | **None found from the maker.** Its listing shows no product image, only the site logo | Take it: front, top and back of the unit, as above |

Reviews of the sibling SMK-37 Pro exist
([Synthtopia](https://www.synthtopia.com/?p=149193),
[heise](https://heise.de/-10503740)), but the Pro's panel is not the Elite's.
Don't draw the Elite from them.
