"""Build the Meet and Test mode fixtures, each with a known answer, plus a short Hinglish clip.

Usage: uv run --project api python scripts/make_mode_fixtures.py   (macOS: needs `say`; Node for the demo recording)
Writes to scripts/fixtures/: meeting.mp4 + meeting.answers.json, demo.mp4, hinglish.wav.
"""

import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
OUT = HERE / "fixtures"
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
GAP_S = 0.5

# (voice, line, slide index). Slide 1 shows Mei's docs task, which nobody says aloud: only the frame has it.
MEETING = [
    ("Samantha", "Okay everyone, this is the Q4 launch sync. First topic, pricing.", 0),
    ("Daniel", "We agreed the Pro plan stays at twelve dollars a month.", 0),
    ("Samantha", "Priya will send the pricing page draft to legal by Friday.", 0),
    ("Rishi", "Arjun here. I will invite fifty beta customers by November third.", 0),
    ("Samantha", "Next, documentation. Mei's task is on the slide.", 1),
    ("Daniel", "One more decision: we are dropping the Android app from this launch.", 1),
    ("Samantha", "Great, thanks all. That's the meeting.", 1),
]
SLIDES = [
    ("Q4 Launch Sync", ["Agenda: pricing, beta, docs", "Pro plan: $12 / month"]),
    ("Docs", ["Mei: update the API docs", "Due: November 5"]),
]
# A short talk that explains an API flow, for the takeaways and diagram.
ARCH = [
    ("Daniel", "Today, how login works in our app.", 0),
    ("Daniel", "The mobile client sends the username and password to the API gateway.", 0),
    ("Daniel", "The gateway forwards the request to the auth service.", 0),
    ("Daniel", "The auth service checks the password hash in the user database.", 1),
    ("Daniel", "If it matches, the auth service returns a signed token to the gateway, and the gateway returns it to the client.", 1),
    ("Daniel", "Every later request carries that token, so the database is not hit again.", 1),
]
ARCH_SLIDES = [
    ("Login flow", ["Client -> API Gateway -> Auth Service"]),
    ("Token", ["Auth Service -> User DB (password hash)", "Returns a signed token"]),
]
# The answer key for action-item F1. An item matches when its kind agrees and every keyword appears in
# text + owner + deadline (lowercase).
ANSWERS = [
    {"kind": "decision", "keywords": ["pro", "12"]},
    {"kind": "action", "keywords": ["priya", "legal", "friday"]},
    {"kind": "action", "keywords": ["arjun", "50", "beta"]},
    {"kind": "action", "keywords": ["mei", "docs", "nov"]},
    {"kind": "decision", "keywords": ["android"]},
]
# Narration for the Taskly demo, at the times eval_demo/record.mjs performs each step.
DEMO_SPEECH = [
    (0.5, "This is Taskly, our to do app. Let me show you how to add a task."),
    (8.0, "Now I'll add a second task and press enter."),
    (14.0, "To finish a task, tick its checkbox."),
    (19.0, "Clear completed removes the finished tasks."),
]
HINGLISH = "Aaj hum retention ke baare mein baat karenge. Hamara target forty percent hai, aur yeh har week measure hota hai."


def run(*cmd: str) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def seconds(path: Path) -> float:
    return float(run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)))


def slide(title: str, lines: list[str], out: Path) -> None:
    img = Image.new("RGB", (1280, 720), "white")
    d = ImageDraw.Draw(img)
    d.text((80, 80), title, fill="black", font=ImageFont.truetype(FONT, 72))
    for i, line in enumerate(lines):
        d.text((80, 240 + i * 90), line, fill="black", font=ImageFont.truetype(FONT, 52))
    img.save(out)


def talk(tmp: Path, lines: list, slides: list, name: str) -> None:
    """Slides plus voiced lines, each slide shown from the first line that uses it."""
    tmp = tmp / name
    tmp.mkdir()
    clips, t, starts = [], 0.0, []
    for i, (voice, line, _) in enumerate(lines):
        clip = tmp / f"m{i}.aiff"
        run("say", "-v", voice, "-o", str(clip), line)
        starts.append(t)
        clips.append(clip)
        t += seconds(clip) + GAP_S
    for i, (title, body) in enumerate(slides):
        slide(title, body, tmp / f"s{i}.png")
    # Video: each slide from the first line that uses it until the next slide starts.
    first = [next(starts[k] for k, m in enumerate(lines) if m[2] == i) for i in range(len(slides))] + [t]
    concat = "".join(f"file '{tmp / f's{i}.png'}'\nduration {first[i + 1] - first[i]:.2f}\n" for i in range(len(slides)))
    (tmp / "slides.txt").write_text(concat + f"file '{tmp / f's{len(slides) - 1}.png'}'\n")
    pad = "".join(f"[{i}:a]apad=pad_dur={GAP_S}[a{i}];" for i in range(len(clips)))
    run("ffmpeg", "-v", "error", "-y", *[a for c in clips for a in ("-i", str(c))],
        "-filter_complex", pad + "".join(f"[a{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=0:a=1[a]",
        "-map", "[a]", "-ar", "16000", "-ac", "1", str(tmp / "meeting.wav"))
    run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(tmp / "slides.txt"),
        "-i", str(tmp / "meeting.wav"), "-vf", "fps=10,format=yuv420p", "-c:v", "libx264", "-c:a", "aac",
        "-shortest", str(OUT / f"{name}.mp4"))


def demo(tmp: Path) -> None:
    video = subprocess.run(["node", "record.mjs"], cwd=HERE / "eval_demo", check=True, capture_output=True,
                           text=True).stdout.strip()
    inputs, delays = [], []
    for i, (at, line) in enumerate(DEMO_SPEECH):
        clip = tmp / f"d{i}.aiff"
        run("say", "-v", "Samantha", "-o", str(clip), line)
        inputs += ["-i", str(clip)]
        delays.append(f"[{i + 1}:a]adelay={int(at * 1000)}:all=1[d{i}]")
    mix = ";".join(delays) + ";" + "".join(f"[d{i}]" for i in range(len(DEMO_SPEECH))) + \
        f"amix=inputs={len(DEMO_SPEECH)}:normalize=0[a]"
    run("ffmpeg", "-v", "error", "-y", "-i", video, *inputs, "-filter_complex", mix, "-map", "0:v", "-map", "[a]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(OUT / "demo.mp4"))
    Path(video).unlink()


def hinglish(tmp: Path) -> None:
    run("say", "-v", "Rishi", "-o", str(tmp / "h.aiff"), HINGLISH)
    run("ffmpeg", "-v", "error", "-y", "-i", str(tmp / "h.aiff"), "-ar", "16000", "-ac", "1", str(OUT / "hinglish.wav"))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as d:
        talk(Path(d), MEETING, SLIDES, "meeting")
        (OUT / "meeting.answers.json").write_text(json.dumps(ANSWERS, indent=2))
        talk(Path(d), ARCH, ARCH_SLIDES, "architecture")
        demo(Path(d))
        hinglish(Path(d))
    for f in sorted(OUT.iterdir()):
        print(f.name, f"{seconds(f):.1f}s" if f.suffix in (".mp4", ".wav") else "")
