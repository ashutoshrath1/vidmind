# VidMind design notes

Derived from the code: `app/globals.css`, `app/layout.tsx`, `components/Logo.tsx`, `components/HeroScene.tsx`,
`app/page.tsx`, `components/RunPanel.tsx`, `components/Highlights.tsx`, `app/opengraph-image.tsx`. If this file and
the code disagree, the code wins.

## Concept: the prism

Video goes in as white light; a glass prism splits it into a spectrum of checked notes. Everything follows that one
picture:

- **Logo** (`PrismMark`): a play button that is also a glass prism. A white beam enters on the left; the top facet
  runs cyan to violet, the bottom violet to pink. It turns in once on load (`prism-in`, 1.4 s), tilts toward the
  pointer on hover, and the beam pulses (`beam`, 2.4 s). The same mark is used in the header, the favicon and the
  share images.
- **Scene**: the home backdrop is a WebGL prism. Video frames stream in on a white beam; three rays leave the tip,
  labelled **Heard** (cyan, Muse Voice, 0:22), **Seen** (violet, SAM 3.1 + Spark, 1:24) and **Proven** (pink,
  Evidence check, 3:07), each carrying note cards with a timestamp and a green tick.
- **Colours**: the spectrum is `--cyan`, `--scan` (violet), `--pink`. `.grad-text`, `.trace`, the comet and the
  launch flash all use that order.
- **Launch**: submitting a video dives the camera into the prism; a flash of spectrum light carries the page to the
  result.

## Tokens

Named by role, so components never change when values do. Dark follows the system until the theme switch sets
`data-theme` on `<html>`; a script in `<head>` applies the saved choice before first paint. `color-scheme: light dark`
so native controls follow. `viewport.themeColor` is `#f3f4fb` (light) / `#04050d` (dark).

| Token | Role | Light | Dark |
|---|---|---|---|
| `--lightbox` | page | `#f3f4fb` | `#04050d` |
| `--sheet` | surface | `#ffffff` | `rgb(17 18 40 / 0.6)` |
| `--ink` | text | `#111827` | `#eceeff` |
| `--graphite` | secondary text (7:1 on white) | `#4b5563` | `#9aa0c3` |
| `--rule` | lines, rings | `#e2e4f0` | `rgb(160 166 220 / 0.16)` |
| `--scan` | violet: the agent is acting, primary fill | `#5b45f0` | `#8b7bff` |
| `--on-scan` | text on a violet fill (6.4:1) | `#ffffff` | `#0b0820` |
| `--scan-ink` | violet as text (7:1) | `#4b33e0` | `#b1a7ff` |
| `--scan-soft` | violet tint | `rgb(91 69 240 / 0.1)` | `rgb(139 123 255 / 0.16)` |
| `--cyan` | spectrum | `#0891b2` | `#3ee8ff` |
| `--pink` | spectrum | `#db2777` | `#ff5cc8` |
| `--wait` | pending / waiting as text (5.0:1) | `#b45309` | `#f59e0b` |
| `--marker` | highlighter on verified quotes | `#ffe45c` | `rgb(233 201 58 / 0.3)` |
| `--proof` | verified, as text (5.0:1) | `#15803d` | `#34d399` |
| `--proof-soft` | verified tint | `rgb(22 163 74 / 0.1)` | `rgb(52 211 153 / 0.14)` |
| `--strike` | danger / removed | `#dc2626` | `#f87171` |
| `--strike-soft` | danger tint | `rgb(220 38 38 / 0.08)` | `rgb(248 113 113 / 0.12)` |

All are exposed to Tailwind via `@theme inline` (`bg-scan`, `text-scan-ink`, `ring-rule`, ...).

Backdrops and surfaces:

- **Ambient** (every page): `.aurora`, three blurred blobs (violet, pink, cyan) drifting over 22/28/34 s plus film
  grain at 7% opacity; `.spotlight`, a soft violet light following the pointer through `--sx`/`--sy` (CSS only, no
  React re-render).
- **Dark only**: `--mission-bg`, a faint 32px grid with two glows; `.bg-sheet` gets `backdrop-filter: blur(14px)`;
  `.scanning` gets a violet neon edge.
- `.glass`: `--sheet` at 70% with `blur(18px) saturate(140%)`. `.trace`: a conic spectrum light running around a
  border (5 s). `.grad-text`: cyan to violet to pink to cyan, shifting over 8 s.
- Focus: 2px `--scan` outline, 2px offset. Selection uses `--scan-soft`; caret is `--scan`.

## Typography

| Face | Variable | Tailwind | Role |
|---|---|---|---|
| Space Grotesk | `--font-grotesk` | `font-display` | headlines, buttons, tab labels, counts, step names |
| Geist | `--font-geist` | `font-sans` (body default) | reading text |
| JetBrains Mono | `--font-jetbrains` | `font-mono` | agent logs, data, timecodes in the scene and post image |

Scale (rem): `xs` and `sm` are both 0.875 (nothing smaller than 14px from the scale), `base` 1, `lg` 1.125, `xl`
1.5, `2xl` 2, `3xl` 2.5. The home headline uses Tailwind's `text-5xl` / `sm:text-7xl` with `leading-[0.95]` and
`tracking-tight`. Body uses lining figures; `.tabular` adds tabular figures for numbers that change while watched.
The one off-scale size is the tab count badge (`text-[11px]`).

## Layout

**Home (`/`)**: one screen (`min-h-dvh`), the WebGL scene full-bleed behind it, a gradient scrim keeping the copy
readable where the beam passes (top-to-bottom on phones, left-to-right from `lg`).

```
┌──────────────────────────────────────────────────────────────────────┐
│ [prism] VidMind                 How it works  Example  [theme]      │
│                                                                      │
│ Any lecture./meeting./product demo./talk.     (rotating, grad-text) │
│ Notes with proof.                                    ╲ Heard         │
│ one line: watches, listens, reads every slide   ═════◆── Seen       │
│ ┌ glass + trace ──────────────────────────────┐      ╱ Proven        │
│ │ Add a file | Paste a YouTube or Vimeo link… [Make notes] │         │
│ └─────────────────────────────────────────────┘                      │
│ (Auto) (Lecture) (Meeting) (Demo)  mode radio group, sent with job │
│ Your notes (✓ title · 5 min ago) ...  up to 3, last 24 h             │
│                                                                      │
│ ~10 s for a 5-min video   100% ...   N min saved   4 Meta models    │
│ privacy line                                    hackathon credit     │
└──────────────────────────────────────────────────────────────────────┘
```

The composer shows the plan before you commit: file size, length, resolution chips, and an estimated time split
into listening / keyframes and screen text / notes and checks. Paste a link or drop a file anywhere on the page.
The stats row is hidden below `sm`.

**Result (`/jobs/[id]`)**: sticky header (logo, title, channel, theme). The run panel's segmented step bar spans
the top. Below, two columns from `lg` (5fr / 7fr): left is the video, then folds for Fact check, Models in this
video and Summary card; right is the "In short" summary, then tabs: Notes, Keyframes, Ask the video, Behind the
scenes (plus mode tabs for actions or tests). The page enters with `.page-enter`.

**About (`/about`)**: the long tour (`Landing`): features, a replayed run, the models, measured numbers, questions,
with a sticky blurred header and a "Make notes" button back to home.

## Motion

**The one authored moment: launch.** On submit, the copy lifts away (`.launch-out`, 450 ms, blur 10px), the camera
dives into the prism over `LAUNCH_S` = 1.25 s (speed to 80x, fov 40 to 95, rays and glow flare), and
`.launch-flash` (a radial spectrum from the prism: white, cyan, violet, pink, page) scales in over 1250 ms. The
route is pushed at 1250 ms; on the result page `.land-flash` fades out of the same light over 800 ms (flagged
through `sessionStorage`). A 4 s fallback loads the page directly if client navigation stalls.

Supporting motion, each tied to a real event: the run bar's **comet** (spectrum light riding the step segments,
gliding 1100 ms between updates, forward only, shimmering while live, flaring at the finish, then `.track-sweep`
passes over the finished bar); `.scanning` over work in progress; `.narrate` for each new step line; `.arrive`
for content landing; `.stamp`, `.shake`, `.pop`, `.flash`, `.burst` for verdicts and the finish; the headline word
rotating every 2.4 s.

**Reduced motion**: the WebGL scene is not loaded at all; the static CSS scene (`Hero3D`, a complete still) shows
instead on `lg`. The same happens without WebGL. Launch navigates immediately with no flash; `.land-flash` is
hidden. The comet stops gliding, the sweep and bursts are hidden, `.scanning` becomes a steady tint, the headline
word stops rotating, and the aurora, grad-text, trace and logo animations stop.

## 3D scene (`HeroScene.tsx`)

- React Three Fiber, loaded with `dynamic(..., { ssr: false })` only after the page is up. `frameloop` is "never"
  while the canvas is off screen (IntersectionObserver), so hidden pages cost nothing.
- Beams, sparks (480), stars (1400, stretching into warp streaks), the grid floor and the prism glass are small
  shaders driven by time alone; the CPU only updates shared uniforms per frame. Frames, cards and labels are canvas
  textures drawn with the page's fonts. The random sky is seeded, so it is the same every render.
- **Palettes**: additive glows vanish on white, so `INK.light` uses deeper colours (`#0891b2`, `#5b45f0`,
  `#db2777`, beam `#4b4f86`) with normal blending; `INK.dark` uses `#3ee8ff`, `#8b7bff`, `#ff5cc8` and a white beam
  with additive blending. The scene follows the theme switch and system setting.
- **Effects**: dark gets `UnrealBloomPass` (strength 0.7, radius 0.32, threshold 0.72) then `SMAAPass`; light gets
  SMAA only (a glow adds nothing on white). Set with `renderer.setEffects`. Bloom wiped the image when the scene
  buffer was multisampled (three r186 on Metal: the canvas read back empty), so the canvas has `antialias: false`
  and SMAA smooths edges instead. Output buffer is `HalfFloatType`.
- **Colour**: shaders are written in display (sRGB) values so they match the CSS tokens, skip tone mapping, and
  end with `sRGBTransferEOTF` then `#include <colorspace_fragment>`, so colours are the same whether drawn into the
  effects' linear buffer or straight to the screen.
- **Performance budget**: 60 fps (16.7 ms) on an M2. Bloom's full-screen high-precision buffers took 22 ms a frame
  at Retina density, so dark caps `dpr` at 1.25; light has no bloom and stays sharp at 1.75. In development the
  renderer is exposed as `window.__vidmindGl` for the performance check.
- Layout: from 900px wide the prism sits right of the copy; narrower, it moves down and back and scales to 0.8.
  The rig turns gently toward the pointer.

## Share images

- **Post image** (`Highlights.tsx`): 1080x1350 PNG (4:5, the largest a feed shows), always dark (`#05060f`): the
  mark, the title, chips for notes proven / video length / takeaways, the diagram, and the takeaways with their
  timestamps. Everything on it comes from the checked result. Fonts are read from the page's CSS variables.
- **Diagram**: Mermaid with `theme: "base"` and brand variables for each theme (dark: `#17163a` nodes, `#8b7bff`
  borders; light: `#f1efff` nodes, `#5b45f0` borders), `securityLevel: "strict"`, and system fonts, because an SVG
  drawn to a canvas can't use web fonts.
- **Link card** (`opengraph-image.tsx`): 1200x630, dark gradient `#04050d` to `#120d33` to `#2a0b2a`, the mark, the
  headline "Notes you can check against the video.", and a sample note with "On screen at 0:30", "Never said aloud"
  and a "Checked" stamp.

## Principles

1. **One metaphor.** Light through a prism. New visuals should be part of it, not a second idea.
2. **No eyebrow labels** above headings. Use sentence-case headings and separate chips instead of all-caps kickers
   or `·`-joined meta lines.
3. **Drawn icons, not emoji.** One stroked set (`Icon.tsx`: 24px grid, 1.75 stroke).
4. **Only measured numbers.** Stats, timings and estimates come from the trace or measured runs; never fake
   progress or stages. The progress bar only moves forward and caps at 96% until the run finishes.
5. **Honesty in the UI.** A precomputed sample says "Precomputed sample. Not generated live." A reused result says
   so. Linking a video asks for confirmation of rights. The footer says that the video, transcript and screen text
   go to the model provider. Uploads are deleted after 24 hours.
6. **Accessible by default.** Text tokens meet contrast (graphite and scan-ink 7:1, proof and wait 5.0:1, on-scan
   6.4:1). `.hit` gives small inline controls a 44px touch target without resizing them. Decorative motion is
   `aria-hidden`; the scene has a text label.
