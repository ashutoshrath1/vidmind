"""Which model does which job, and where it is reached. All of it comes from environment variables; the defaults are
Meta Muse. A model is written "provider:model". A provider is a built-in (muse, groq, nvidia, apple) or any
OpenAI-compatible server added with PROVIDER_<NAME>_BASE_URL and PROVIDER_<NAME>_API_KEY. See README "Use other models"."""

import os
import threading
from dataclasses import dataclass, replace
from functools import lru_cache

from openai import OpenAI


@dataclass(frozen=True)
class Provider:
    name: str  # "" is the bare-id provider: LLM_BASE_URL with LLM_API_KEY
    base_url: str
    key_env: str | None = None  # the variable that holds its key (PROVIDER_<NAME>_API_KEY works for every provider)
    kind: str = "openai"  # request dialect for images, speech and segmentation: "openai" (standard) or "muse"
    effort: str | None = None  # reasoning_effort sent with notes calls; None = LLM_REASONING_EFFORT, "" = not sent
    max_in_flight: int = 8  # requests at once, so parallel sections and jobs queue instead of tripping rate limits
    hedge_s: float | None = None  # seconds before a backup model is added; None = pipeline.HEDGE_S
    spread: bool = True  # rotate sections across the leading models (for per-model rate limits)
    exclusive: bool = False  # when keyed, the notes pool holds only this provider's models
    local: bool = False  # needs no key


BUILTIN = {
    # ~10x faster than NVIDIA's free tier; free plan: 30 requests and 8K tokens a minute per model.
    "groq": Provider("groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY", max_in_flight=6, hedge_s=6.0),
    "nvidia": Provider("nvidia", "https://integrate.api.nvidia.com/v1", "NVIDIA_API_KEY"),
    # Muse Spark: "minimal" effort gave the same grounded notes as "low", 30% faster, 20% cheaper (Oct 26 bench);
    # 3,000 requests a minute, so no spreading; both Sparks at once (hedge 0), and it alone fills the notes pool.
    "muse": Provider("muse", "https://api.meta.ai/v1", "MODEL_API_KEY", kind="muse", effort="minimal",
                     max_in_flight=24, hedge_s=0.0, spread=False, exclusive=True),
    # Apple's on-device model: `fm serve --port 1976` (macOS 26+). Free and private, but its notes failed grounding.
    "apple": Provider("apple", "http://localhost:1976/v1", max_in_flight=1, local=True),
}

# Role -> (variable, default). An empty variable turns the role off.
ROLES = {
    "image": ("IMAGE_MODEL", "muse:muse-image-1.0"),  # chapter illustrations and the summary card
    "segment": ("SEGMENT_MODEL", "muse:sam-3.1"),  # finds diagrams in the video, for enlarged crops
    "speech": ("SPEECH_MODEL", "muse:muse-voice-transcribe-1.0"),  # hosted speech recognition (else local ASR)
    "reader": ("READER_MODEL", "muse:muse-spark-1.3"),  # reads the text on keyframes (else local OCR)
}
NOTES_DEFAULT = "muse:muse-spark-1.2,muse:muse-spark-1.3"
VISION_DEFAULT = "muse:muse-spark-1.3"


def _env(name: str, field: str) -> str:
    return f"PROVIDER_{name.upper().replace('-', '_')}_{field}"


def setting(name: str, default):
    """A tuning constant that an environment variable can override; the default's type decides how it is read."""
    return type(default)(os.environ.get(name, default))


def env_list(name: str, default: str) -> list[str]:
    return [m.strip() for m in os.environ.get(name, default).split(",") if m.strip()]


def provider(model: str) -> str:
    """The provider name in "provider:model", or "" for a bare id (which keeps its own colons and slashes)."""
    prefix, sep, _ = model.partition(":")
    return prefix if sep and (prefix in BUILTIN or os.environ.get(_env(prefix, "BASE_URL"))) else ""


def bare(model: str) -> str:
    return model.split(":", 1)[1] if provider(model) else model


def get(name: str) -> Provider:
    p = BUILTIN.get(name) or Provider(name, os.environ.get("LLM_BASE_URL", BUILTIN["muse"].base_url) if not name else "")
    if not name:
        return p
    e = lambda f: os.environ.get(_env(name, f))  # noqa: E731
    over = {}
    if v := e("BASE_URL"):
        over["base_url"] = v
    if v := e("KIND"):
        over["kind"] = v
    if (v := e("EFFORT")) is not None:
        over["effort"] = v
    if v := e("MAX_IN_FLIGHT"):
        over["max_in_flight"] = int(v)
    if v := e("HEDGE_S"):
        over["hedge_s"] = float(v)
    return replace(p, **over)


def of(model: str) -> Provider:
    return get(provider(model))


def key(p: Provider) -> str | None:
    if p.local:
        return "local"
    if p.name and (own := os.environ.get(_env(p.name, "API_KEY"))):
        return own
    if not p.name:
        return os.environ.get("LLM_API_KEY") or os.environ.get("MODEL_API_KEY")
    return os.environ.get(p.key_env) if p.key_env else None


def available(model: str) -> bool:
    """True when the model is set and its provider has a key."""
    return bool(model) and bool(key(of(model)))


def role(name: str) -> str:
    var, default = ROLES[name]
    return os.environ.get(var, default).strip()


def reasoning_effort(p: Provider) -> str:
    return p.effort if p.effort is not None else os.environ.get("LLM_REASONING_EFFORT", "low")


@lru_cache
def _slots(name: str, n: int) -> threading.BoundedSemaphore:
    return threading.BoundedSemaphore(n)


def slot(p: Provider) -> threading.BoundedSemaphore:
    return _slots(p.name, p.max_in_flight)


@lru_cache  # one client per provider, so its HTTP connections are reused across sections and jobs
def client(name: str) -> OpenAI:
    p = get(name)
    if not (k := key(p)) or not p.base_url:
        raise RuntimeError(f"No key or base URL for provider {name or p.base_url!r}. Set it in .env and restart the API.")
    # Replies are streamed, so this bounds the wait for the first token and between chunks, not the whole reply.
    # Hedging covers slow models; this only frees a hung connection's slot.
    return OpenAI(base_url=p.base_url, api_key=k, timeout=60, max_retries=1)


def notes() -> list[str]:
    """The pool sections are spread across, in priority order; models whose provider has no key are skipped."""
    pool = [m for m in env_list("LLM_MODELS", NOTES_DEFAULT) if available(m)]
    # An exclusive provider (Muse) that is keyed gets the whole pool: its own older version is the backup.
    if lead := next((of(m) for m in pool if of(m).exclusive), None):
        pool = [m for m in pool if provider(m) == lead.name]
    if not pool:
        raise RuntimeError("No notes model has an API key. Set MODEL_API_KEY (Muse) or the key of a provider in LLM_MODELS.")
    return pool


def is_vision(model: str) -> bool:
    return model in env_list("LLM_VISION_MODELS", VISION_DEFAULT)
