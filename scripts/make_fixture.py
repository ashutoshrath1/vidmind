"""Build a 60 s test clip with known facts, one of which is shown on screen but never spoken.

Usage: uv run --project api python scripts/make_fixture.py [out_dir]   (macOS: needs `say`)
Writes fixture.mp4 and fixture.annotations.json.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SLIDE_S = 20
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
SLIDES = [
    {
        "title": "Product Analytics 101",
        "body": ["Activation = first project created"],
        "speech": "Welcome to product analytics one oh one. We define activation as the moment "
                  "a user creates their first project.",
    },
    {
        "title": "Retention",
        "body": ["Week-1 retention target: 40%", "Measured on signup cohorts"],
        # The 40% target is deliberately never spoken: only the frame can supply it.
        "speech": "Next, retention. Retention tells us how many users come back after their first week. "
                  "Our target is shown on this slide.",
    },
    {
        "title": "North Star Metric",
        "body": ["Weekly active projects"],
        "speech": "Finally, our north star metric is weekly active projects, because it tracks "
                  "the value customers actually get.",
    },
]
FACTS = [
    {"id": "activation", "keywords": ["activation", "first project"], "slide": 0, "source": "both"},
    {"id": "retention_target", "keywords": ["40%"], "slide": 1, "source": "frame"},
    {"id": "north_star", "keywords": ["weekly active projects"], "slide": 2, "source": "both"},
]


def draw_slide(slide: dict, path: Path) -> None:
    img = Image.new("RGB", (1280, 720), "white")
    d = ImageDraw.Draw(img)
    d.text((80, 90), slide["title"], fill="#0f172a", font=ImageFont.truetype(FONT, 72))
    for i, line in enumerate(slide["body"]):
        d.text((80, 260 + i * 90), line, fill="#1e293b", font=ImageFont.truetype(FONT, 56))
    img.save(path)


def main(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        inputs, filters = [], []
        for i, s in enumerate(SLIDES):
            draw_slide(s, tmp / f"s{i}.png")
            subprocess.run(["say", "-o", str(tmp / f"n{i}.aiff"), s["speech"]], check=True)
            inputs += ["-loop", "1", "-framerate", "25", "-t", str(SLIDE_S), "-i", str(tmp / f"s{i}.png")]
        for i in range(len(SLIDES)):
            inputs += ["-i", str(tmp / f"n{i}.aiff")]
            filters.append(f"[{len(SLIDES) + i}]adelay=1000:all=1,apad=whole_dur={SLIDE_S}[a{i}]")
        n = len(SLIDES)
        v_in = "".join(f"[{i}]" for i in range(n))
        a_in = "".join(f"[a{i}]" for i in range(n))
        filters += [f"{v_in}concat=n={n}:v=1:a=0,format=yuv420p[v]", f"{a_in}concat=n={n}:v=0:a=1[a]"]
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs,
             "-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]",
             "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", str(out_dir / "fixture.mp4")],
            check=True,
        )
    facts = [
        {"id": f["id"], "keywords": f["keywords"], "source": f["source"],
         "start_seconds": f["slide"] * SLIDE_S, "end_seconds": (f["slide"] + 1) * SLIDE_S}
        for f in FACTS
    ]
    (out_dir / "fixture.annotations.json").write_text(json.dumps({"facts": facts}, indent=2))
    print(out_dir / "fixture.mp4")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures"))
