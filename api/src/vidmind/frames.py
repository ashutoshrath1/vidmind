"""Representative keyframes (ffmpeg scene detection) and on-screen text (Apple Vision on macOS, else Tesseract)."""

import re
import subprocess
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytesseract
from PIL import Image

from .schema import Frame

MAX_FRAMES = 30  # one per new image; SAM, OCR and Spark each see every one
UNIFORM_EVERY_S = 20.0
SCENE_THRESHOLD = 0.005  # catches typing and clicks in screen recordings; slide decks still cut once per slide
MIN_SCENE_S = 1.0
SETTLE_S = 1.0  # grab this long after a change, once the new image has finished drawing
OCR_WORD_CONF = 60
OCR_LOW_MEAN_CONF = 70


def ff_input(src: Path | str, headers: str = "") -> list[str]:
    """ffmpeg input args for a local file or a stream URL; ffmpeg reads URLs with ranged requests, no download."""
    return [*(["-headers", headers] if headers else []), "-i", str(src)]


def scene_cuts(video: Path | str, headers: str = "", duration: float = 0) -> list[float]:
    """Timestamps where ffmpeg's scene score jumps above the threshold. A stream is scanned as 4 ranges at once:
    a 10-minute 360p YouTube stream in 1.04 s vs 2.00 s, with the same 493 cuts."""
    def scan(*span: str) -> list[float]:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", *span, *ff_input(video, headers), "-an",
             "-vf", f"select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-f", "null", "-"],
            capture_output=True, text=True, check=True,
        )
        return [float(t) for t in re.findall(r"pts_time:([\d.]+)", proc.stderr)]

    if not (isinstance(video, str) and video.startswith("http") and duration > 120):
        return scan()
    step = duration / SCAN_RANGES
    with ThreadPoolExecutor(SCAN_RANGES) as ex:  # a seeked range's times start at 0: shift them back
        parts = ex.map(lambda i: [t + i * step for t in scan("-ss", f"{i * step:.3f}", "-t", f"{step:.3f}")],
                       range(SCAN_RANGES))
    return sorted(t for part in parts for t in part)


SCAN_RANGES = 4


def pick_times(cuts: list[float], duration: float) -> list[float]:
    """Each new image, SETTLE_S after it appears; uniform sampling when there are too few; capped at MAX_FRAMES."""
    bounds = [0.0, *sorted(c for c in cuts if 0 < c < duration), duration]
    times = [a + min(SETTLE_S, (b - a) / 2) for a, b in zip(bounds, bounds[1:]) if b - a >= MIN_SCENE_S]
    if len(times) < 3:  # too few cuts to trust alone: add evenly spaced frames, but keep the cuts that were found
        n = max(3, int(duration // UNIFORM_EVERY_S))
        uniform = [(i + 0.5) * duration / n for i in range(n)]
        times = sorted(uniform + [t for t in times if all(abs(t - u) >= MIN_SCENE_S for u in uniform)])
    if len(times) > MAX_FRAMES:
        step = len(times) / MAX_FRAMES
        times = [times[int(i * step)] for i in range(MAX_FRAMES)]
    return [round(t, 2) for t in times]


def extract_frame(video: Path | str, t: float, out: Path, headers: str = "") -> None:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(t), *ff_input(video, headers),
         "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", str(out)],
        check=True,
    )


def ocr_engine() -> str:
    """The OCR engine ocr() will use, by name, for the run log."""
    try:
        import ocrmac  # noqa: F401
        return "Apple Vision OCR"
    except ImportError:
        return "Tesseract OCR"


def ocr(image: Path) -> tuple[str, float]:
    """Returns (text with line breaks, mean confidence 0-100).

    Apple Vision when available: on 12 dark diagram frames from a real lecture it read logos, labels and code
    that Tesseract turned into noise ("kubernetes | docker | GitLab" vs "ogoadoo00000"), in 1.2 s vs 2.9 s."""
    try:
        return _ocr_apple_vision(image)
    except ImportError:
        pass
    try:
        return _ocr_tesseract(image)
    except pytesseract.TesseractNotFoundError:  # no OCR engine installed: keep the frames, skip their text
        return "", 0.0


def _ocr_apple_vision(image: Path) -> tuple[str, float]:
    from ocrmac import ocrmac  # macOS only; ImportError elsewhere selects Tesseract

    lines = ocrmac.OCR(str(image), recognition_level="accurate").recognize()  # [(text, conf 0-1, bbox)]
    kept = [(text, conf) for text, conf, _ in lines if conf >= OCR_WORD_CONF / 100]
    confs = [conf * 100 for _, conf, _ in lines]
    return "\n".join(text for text, _ in kept), (sum(confs) / len(confs) if confs else 0.0)


def _ocr_tesseract(image: Path) -> tuple[str, float]:
    data = pytesseract.image_to_data(Image.open(image).convert("L"), output_type=pytesseract.Output.DICT)
    lines: dict[tuple, list[str]] = {}
    confs = []
    for word, conf, *key in zip(data["text"], data["conf"], data["block_num"], data["par_num"], data["line_num"]):
        conf = float(conf)
        if not word.strip() or conf < 0:
            continue
        confs.append(conf)
        if conf >= OCR_WORD_CONF:
            lines.setdefault(tuple(key), []).append(word)
    text = "\n".join(" ".join(ws) for ws in lines.values())
    return text, (sum(confs) / len(confs) if confs else 0.0)


def sample_frames(
    video: Path | str, duration: float, out_dir: Path, scan: Path | str | None = None, headers: str = ""
) -> list[Frame]:
    """Scene detection decodes every frame, so it runs on `scan` (a low-resolution stream) when given; only the
    picked frames are read from full-resolution `video`, in parallel since each grab is a short seek."""
    return grab_frames(video, pick_times(scene_cuts(scan or video, headers), duration), out_dir, headers)


def grab_frames(video: Path | str, times: list[float], out_dir: Path, headers: str = "") -> list[Frame]:
    out_dir.mkdir(exist_ok=True)
    frames = [Frame(t=t, url=f"frames/{i}.jpg") for i, t in enumerate(times)]
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(lambda f: extract_frame(video, f.t, out_dir / Path(f.url).name, headers), frames))
    return frames


def read_text(frames: list[Frame], job_dir: Path, on_frame: Callable[[Frame, float], None] | None = None) -> None:
    """OCR each frame in place; on_frame(frame, seconds) reports each one as it is read."""
    for f in frames:
        started = time.monotonic()
        f.ocr_text, f.ocr_conf = ocr(job_dir / f.url)
        f.low_conf = bool(f.ocr_text) and f.ocr_conf < OCR_LOW_MEAN_CONF
        if on_frame:
            on_frame(f, time.monotonic() - started)
