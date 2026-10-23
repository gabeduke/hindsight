# Share the mix

Agreed with Gabe on 2026-10-23, from two things he ran into on his phone in
the Studio.

**He wanted to send his brother what was on the tape, and couldn't.** BOUNCE
plays the tape out of the interface and records it back in (`mixdown.go`:
"Nothing is rendered offline"), so the Sidekick's EQ and FX and anything
played over it are in the take. That is why it needs the jam room, the
interface on, and the output lined up with the capture. With the tape
playing on the phone, Bounce opens the jam room's refusal, which is about
something else (*Rec and Catch need the jam room*) and whose one way on is
*Switch to the jam room*, of no use with the interface off. With the
interface off, Bounce's toast says *the output isn't open*. The Studio's
only other way out is *Export stems*, a zip of a file per track for a DAW.

Yet the Pi already renders the tape without the interface:
`GET /api/tapes/listen?all=1` (`internal/tape/listen.go`, made for *Tape on
this phone*) is the tape as it sounds, every track at its level and pan,
mutes and solos as they are, bus A and bus B summed, through the renderer
the tape plays with. Nothing on screen saves or sends it.

**He looked for |◀ and didn't find it.** The phone's mini player shows the
counter window, ▶ and Catch; |◀, ↺ 5 s and ⟲ are only in the player that a
tap on the window pulls up, and nothing says so.

## Decisions

| | |
|---|---|
| Share the mix | A new item in the Studio's ⋯, after Bounce, on every device. The Pi renders the whole tape, from its start to the end of its last part, as `listen` does, and encodes it as an MP3 with the ffmpeg a take's Download uses (128 kbps), named after the tape and the day (*For my brother 2026-10-23.mp3*). A toast says it is rendering; when it's ready, the toast's **Share** gives it to the phone's share sheet (Messages, WhatsApp, mail). Where the sheet can't take a file, as on a computer, it downloads. |
| What it is not | It is dry: no Sidekick EQ or FX and nothing played live, and it says so in help mode. It goes nowhere on the shelf, isn't in undo and doesn't stop the tape. It works with the tape on the phone and with the interface off. BOUNCE stays what it is: a take with the Sidekick in it. |
| Bounce's refusal | Says what Bounce needs, in its own words (*Bounce plays the tape through the Sidekick and records it back: it needs the jam room*), and offers **Share the mix** beside *Switch to the jam room*. A bounce refused because the output isn't open says so, with Share the mix on its toast. |
| \|◀ on the phone | The mini player shows \|◀ beside ▶, in both rooms, at 44 px or more: back to the loop's start in the Studio, the take's start in the Listening Room. The counter window gives up the room. The pulled-up player is unchanged. |

### To settle while building it

My recommendation comes first in each.

- **Two taps, not one:** the render takes seconds on a Pi, and a phone only
  opens the share sheet straight from a tap, so the toast's Share is the
  second. `shareClip` in `lib/tape/page.js` already falls back to a
  download when the sheet won't open.
- **The MP3 is a form of `listen`** (`format=mp3`, ffmpeg reading the WAV
  as the renderer writes it), with one render at a time as the stems
  export has, rather than a new route of its own.

## Build order

1. **\|◀ in the mini player.** Static. J4.4 expects \|◀ beside ▶, and goes
   back to the loop's start with it.
2. **Share the mix.** The MP3 from `listen` (Go, so it releases), then the
   ⋯ item, the toast and the refusal's words. A new flow, J3.3: on a phone,
   with the tape playing on the phone, ⋯ → Share the mix → Share hands the
   share sheet an MP3 (the flow stubs `navigator.share` and checks the
   file).

When it lands, fold it into `docs/architecture.md` (*Vocabulary*: Share the
mix beside BOUNCE) and `docs/guide.md`, and delete this spec.
