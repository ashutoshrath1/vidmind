"""Import a video from a link (YouTube, Instagram, Vimeo, direct files...).

yt-dlp only resolves the link: YouTube has no public media API, so finding the stream addresses means reading its
player the way yt-dlp does. For YouTube nothing is downloaded: ffmpeg streams the audio, scans a 360p stream for
scene changes and seeks into the 720p stream for keyframes; creator subtitles replace speech recognition; the page
plays the video in YouTube's own player. Other sites (or videos with embedding disabled) are downloaded.
"""

import ipaddress
import json
import socket
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from urllib.parse import urlparse

import httpx
import yt_dlp
from yt_dlp.extractor.youtube import YoutubeIE
from yt_dlp.utils import DownloadError

from .pipeline import MAX_BYTES, MAX_DURATION_S, Source
from .transcribe import parse_json3, parse_vtt

# Paid / DRM-protected platforms: getting the video out would mean bypassing their protection.
BLOCKED_DOMAINS = ("udemy.com", "netflix.com", "primevideo.com", "disneyplus.com", "hotstar.com",
                   "hulu.com", "max.com", "coursera.org", "linkedin.com", "skillshare.com", "masterclass.com")
FORMAT = "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b"


def _opts(**extra) -> dict:
    return {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 30, **extra}


# YouTube without its 1.5 MB watch page (0.85 s, streamed slowly by YouTube): the player API alone, given the
# anonymous visitor id the page would have set. Skipping the page without that id gets "confirm you're not a bot".
# HLS manifests are skipped too: the streams we use are plain https. Same formats, subtitles and embed flag;
# median link check 1.34 s -> 0.35 s (Oct 31). Anything incomplete falls back to the full extraction.
FAST_YOUTUBE = {"skip": ["hls"], "player_skip": ["webpage", "configs", "initial_data"]}
_visitor: dict = {"id": None, "at": 0.0}


def visitor_id() -> str | None:
    """YouTube's anonymous visitor id (what a first visit sets), kept for an hour; None when it can't be had."""
    if not _visitor["id"] or time.time() - _visitor["at"] > 3600:
        try:
            r = httpx.get("https://www.youtube.com/sw.js_data", timeout=3,
                          headers={"User-Agent": yt_dlp.utils.networking.std_headers["User-Agent"]})
            _visitor.update(id=json.loads(r.raise_for_status().text.removeprefix(")]}'"))[0][2][0][0][13],
                            at=time.time())
        except (httpx.HTTPError, ValueError, LookupError, TypeError):
            return None
    return _visitor["id"]


def _channel(url: str) -> str | None:
    """The channel name, which the fast path lacks (it comes with the watch page); oEmbed answers in ~0.15 s."""
    try:
        return httpx.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"},
                         timeout=2).raise_for_status().json().get("author_name")
    except (httpx.HTTPError, ValueError):
        return None


def _extract(url: str) -> dict:
    if YoutubeIE.suitable(url) and (vid := visitor_id()):
        with ThreadPoolExecutor(1) as ex:
            channel = ex.submit(_channel, url)
            try:
                with yt_dlp.YoutubeDL(_opts(extractor_args={"youtube": {**FAST_YOUTUBE, "visitor_data": [vid]}})) as ydl:
                    info = ydl.extract_info(url, download=False)
                if stream_plan(info) and info.get("title"):  # streamable: else the full path decides (download, errors)
                    return {**info, "channel": channel.result()}
            except DownloadError as e:
                if "not a bot" in str(e):
                    _visitor["id"] = None  # a stale id: fetch a fresh one next time
    with yt_dlp.YoutubeDL(_opts()) as ydl:
        return ydl.extract_info(url, download=False)


def check_url(url: str) -> dict:
    """Validate a link and return yt-dlp's metadata (no download). Raises ValueError with a user-facing message."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not host:
        raise ValueError("Enter a full http(s) link")
    if any(host == d or host.endswith("." + d) for d in BLOCKED_DOMAINS):
        raise ValueError(f"{host} content is paid or copy-protected, so VidMind can't import it. "
                         "Upload a video you own instead.")
    # shortcut: checks the first hop only, not redirects; enough to stop casual SSRF on a demo server.
    try:
        addrs = {ai[4][0] for ai in socket.getaddrinfo(host, None)}
    except socket.gaierror:
        raise ValueError(f"Could not find {host}") from None
    if not all(ipaddress.ip_address(a.split("%")[0]).is_global for a in addrs):
        raise ValueError("Links to private or local network addresses are not allowed")

    try:
        info = _extract(url)
    except DownloadError as e:
        msg = str(e).removeprefix("ERROR: ")
        if "DRM" in msg:
            raise ValueError("This video is DRM-protected, so VidMind can't import it") from None
        raise ValueError(f"Could not open this link: {msg[:300]}") from None
    if info.get("_type") == "playlist":
        raise ValueError("That link is a playlist or channel. Paste a link to a single video")
    if info.get("is_live"):
        raise ValueError("Live streams are not supported")
    duration = info.get("duration")
    if duration and duration > MAX_DURATION_S:
        raise ValueError(f"Video is {duration / 3600:.1f} h; the limit is {MAX_DURATION_S // 3600} hours")
    return info


def cache_key(info: dict) -> str:
    return f"{info.get('extractor_key', 'link')}:{info.get('id') or info.get('webpage_url')}"


def stream_plan(info: dict) -> dict | None:
    """Stream addresses for a YouTube video, or None to download instead. Signed URLs expire after a few hours,
    which is fine: the job starts right away."""
    if info.get("extractor_key") != "Youtube" or info.get("playable_in_embed") is False or not info.get("duration"):
        return None
    fmts = [f for f in info.get("formats", []) if f.get("protocol") in ("http", "https")]
    video_only = [f for f in fmts if f.get("acodec") == "none" and f.get("vcodec") not in (None, "none")]
    audio_only = [f for f in fmts if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]

    def best(max_h: int) -> dict | None:  # H.264 decodes fastest; then the highest resolution under the cap
        fs = [f for f in video_only if (f.get("height") or 0) <= max_h]
        return max(fs, key=lambda f: (str(f.get("vcodec")).startswith("avc1"), f.get("height") or 0), default=None)

    video = best(720)
    if not video:
        return None
    # The original language's track (never an AI dub), at the lowest bitrate: speech needs little.
    audio = min(audio_only, key=lambda f: (-(f.get("language_preference") or 0), f.get("abr") or 1e9), default=None)
    return {
        "youtube_id": info["id"],
        "duration": info["duration"],
        "video": video["url"],
        "scan": (best(360) or video)["url"],
        "audio": audio and audio["url"],
        "headers": "".join(f"{k}: {v}\r\n" for k, v in (video.get("http_headers") or {}).items()),
        "captions": _caption_url(info),
    }


def _caption_url(info: dict) -> str | None:
    """Creator subtitles in the video's language or English; else YouTube's own speech recognition of the original
    audio ("<lang>-orig", json3 with word timings). Using that skips our speech recognition: 0.4 s to fetch, vs
    5-7 s for Muse on a 10-minute video, the longest step before the notes."""
    subs = info.get("subtitles") or {}
    langs = {(info.get("language") or "en").split("-")[0], "en"}
    for key in sorted(subs, key=lambda k: not k.startswith("en")):
        if key.split("-")[0] in langs:
            if url := next((s["url"] for s in subs[key] if s.get("ext") == "vtt"), None):
                return url
    auto = info.get("automatic_captions") or {}
    lang = (_original_audio(info) or {}).get("language") or info.get("language") or "en"
    for key in (f"{lang}-orig", f"{lang.split('-')[0]}-orig"):
        if url := next((s["url"] for s in auto.get(key, []) if s.get("ext") == "json3"), None):
            return url
    return None


def _original_audio(info: dict) -> dict | None:
    """The original audio track, not one of YouTube's AI dubs (an English talk once came back as its German dub,
    the lowest bitrate). yt-dlp ranks the original highest by language_preference."""
    tracks = [f for f in info.get("formats", []) if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]
    return max(tracks, key=lambda f: f.get("language_preference") or 0, default=None)


def stream_source(plan: dict) -> Source:
    captions, auto = None, "fmt=json3" in (plan.get("captions") or "")
    if plan.get("captions"):
        captions = _first_captions(plan["captions"], auto)
    return Source(plan["video"], plan["duration"], audio=plan["audio"], scan=plan["scan"], headers=plan["headers"],
                  captions=captions, youtube_id=plan["youtube_id"],
                  captions_from="YouTube captions (auto)" if auto else "creator subtitles")


def _first_captions(url: str, auto: bool, copies: int = 2) -> list | None:
    """The caption track, asked for twice at once; the first good answer wins. One request once sat 9.4 s while
    the norm is 0.4 s, and the whole job waits on it. None after 3 s: speech recognition covers it."""
    def get() -> list | None:
        body = httpx.get(url, timeout=3).raise_for_status()
        return (parse_json3(body.json()) if auto else parse_vtt(body.text)) or None

    ex = ThreadPoolExecutor(copies)
    try:
        pending = {ex.submit(get) for _ in range(copies)}
        while pending:
            done, pending = wait(pending, return_when=FIRST_COMPLETED)
            for f in done:
                if f.exception() is None and f.result():
                    return f.result()
        return None
    finally:
        ex.shutdown(wait=False, cancel_futures=True)


def download(url: str, job_dir: Path) -> Path:
    opts = _opts(
        format=FORMAT,
        merge_output_format="mp4",
        outtmpl=str(job_dir / "video.%(ext)s"),
        max_filesize=MAX_BYTES,
    )
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except DownloadError as e:
        raise RuntimeError(f"Download failed: {str(e).removeprefix('ERROR: ')[:300]}") from None
    videos = [p for p in job_dir.glob("video.*") if p.suffix not in (".part", ".ytdl")]
    if not videos:
        raise RuntimeError("Download produced no video (it may be over the 2 GB limit)")
    return videos[0]
