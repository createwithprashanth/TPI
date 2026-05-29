"""
Ollama LLM client for XYRA Studio.

Wraps the Ollama HTTP API (OpenAI-compatible endpoint at localhost:11434).
Forces JSON output via Ollama's "format" parameter so responses are always
parseable without regex fallbacks.
"""
import json
import logging
import os
import urllib.request
import urllib.error
from typing import Optional

logger = logging.getLogger(__name__)

# In Docker, set OLLAMA_HOST=http://ollama:11434 so the backend can reach the
# Ollama container by its service name. Falls back to localhost for local dev.
OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434")

# Model names — configurable via .env so no code change is needed per deployment.
INSTRUMENT_MODEL          = os.getenv("XYRA_INSTRUMENT_MODEL",          "xyra-pid-engineer")
INSTRUMENT_MODEL_FALLBACK = os.getenv("XYRA_INSTRUMENT_MODEL_FALLBACK", "qwen2.5:7b")
LINE_MAPPER_MODEL         = os.getenv("XYRA_LINE_MAPPER_MODEL",         "xyra-line-mapper")
LINE_MAPPER_MODEL_FALLBACK= os.getenv("XYRA_LINE_MAPPER_MODEL_FALLBACK","qwen2.5:7b")

# Keep DEFAULT_MODEL as an alias so existing callers don't break.
DEFAULT_MODEL = INSTRUMENT_MODEL

DEFAULT_TIMEOUT = 60  # seconds per LLM call


def _is_available(model: str = DEFAULT_MODEL) -> bool:
    """Return True if Ollama is running and the model is loaded."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_BASE_URL}/api/tags", timeout=3) as resp:
            data = json.loads(resp.read())
            names = [m["name"] for m in data.get("models", [])]
            return any(n.startswith(model.split(":")[0]) for n in names)
    except Exception:
        return False


def generate(
    prompt: str,
    model: str = DEFAULT_MODEL,
    system: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> Optional[dict]:
    """
    Send a single prompt to Ollama and return the parsed JSON response.

    Returns a dict on success, None on any error.
    Always passes "format": "json" so the model outputs valid JSON.
    """
    payload = {
        "model": model,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {
            "temperature": 0.1,   # deterministic — we want consistent structured output
            "num_predict": 256,
        },
    }
    if system:
        payload["system"] = system

    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = json.loads(resp.read())
            return json.loads(raw.get("response", "{}"))
    except urllib.error.URLError as exc:
        logger.warning("Ollama unreachable: %s", exc)
        return None
    except json.JSONDecodeError as exc:
        logger.warning("Ollama returned non-JSON: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Ollama call failed: %s", exc)
        return None
