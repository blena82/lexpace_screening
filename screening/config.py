"""Settings for the screening pipeline, read from the environment (and a local .env file).

API keys stay on the backend: they are read here and never sent to the browser.
"""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent


def _load_dotenv() -> None:
    """Minimal .env loader (repo root, then backend/). Existing env vars win."""
    for path in (ROOT_DIR / ".env", BACKEND_DIR / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

# LLM (question generation + written-expression scoring). Without a key the pipeline
# serves the validated starter items instead, so the demo also works offline.
# Provider: Claude (ANTHROPIC_API_KEY) or Gemini (GEMINI_API_KEY); LEXPACE_LLM_PROVIDER picks one if both are set.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
_HAS_CLAUDE = bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
LLM_PROVIDER = os.environ.get("LEXPACE_LLM_PROVIDER") or ("claude" if _HAS_CLAUDE else "gemini" if GEMINI_API_KEY else "claude")
LLM_MODEL = os.environ.get("LEXPACE_LLM_MODEL") or ("gemini-3.5-flash" if LLM_PROVIDER == "gemini" else "claude-opus-5-5")
# Gemini: when a model is rate limited (free tier: a few requests per minute per model), try the next one.
GEMINI_FALLBACK_MODELS = [m.strip() for m in os.environ.get(
    "LEXPACE_GEMINI_FALLBACK_MODELS", "gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",") if m.strip()]
LLM_ENABLED = os.environ.get("LEXPACE_LLM", "1") != "0" and (
    bool(GEMINI_API_KEY) if LLM_PROVIDER == "gemini" else _HAS_CLAUDE
)
LLM_TIMEOUT_S = float(os.environ.get("LEXPACE_LLM_TIMEOUT", "45"))
# Server-side refusal fallback (beta). Set LEXPACE_LLM_FALLBACKS=0 to turn it off.
LLM_FALLBACKS = os.environ.get("LEXPACE_LLM_FALLBACKS", "1") != "0"

# Trained classifier: path to an exported multi-label model (see classifier.py).
CLASSIFIER_MODEL_PATH = os.environ.get("LEXPACE_CLASSIFIER_MODEL", "")
# Or a Python factory "package.module:function" returning a ScreeningClassifier.
CLASSIFIER_FACTORY = os.environ.get("LEXPACE_CLASSIFIER", "")

# Completed sessions (features + raw trials) are written here for model training.
SESSIONS_DIR = BACKEND_DIR / "data" / "screening_sessions"
MAX_LIVE_SESSIONS = 500
