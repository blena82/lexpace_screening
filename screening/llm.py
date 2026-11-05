"""Thin async wrapper around the Claude or Gemini API. Backend only: the key never reaches the browser.

Every call asks for JSON that matches a schema (structured outputs), then the caller
validates the content again in Python. Any failure raises LLMError, and the caller
falls back to the validated starter items.
"""

import json
import logging
from typing import Any

import anthropic
import httpx

from . import config

log = logging.getLogger("lexpace.llm")


class LLMError(Exception):
    pass


_client: anthropic.AsyncAnthropic | None = None
last_error: str | None = None


def enabled() -> bool:
    return config.LLM_ENABLED


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(timeout=config.LLM_TIMEOUT_S, max_retries=1)
    return _client


def obj(properties: dict, required: list[str] | None = None) -> dict:
    """JSON-schema object for structured outputs (closed, every field required)."""
    return {"type": "object", "properties": properties,
            "required": required if required is not None else list(properties), "additionalProperties": False}


async def generate_json(system: str, prompt: str, schema: dict, *, effort: str = "low", max_tokens: int = 4000) -> dict[str, Any]:
    """One structured-output request. Returns the parsed JSON object or raises LLMError."""
    global last_error
    if not enabled():
        raise LLMError("LLM not configured")
    if config.LLM_PROVIDER == "gemini":
        return await _gemini_json(system, prompt, schema, effort=effort, max_tokens=max_tokens)
    kwargs: dict[str, Any] = dict(
        model=config.LLM_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    if config.LLM_FALLBACKS:
        kwargs.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    try:
        response = await _get_client().beta.messages.create(**kwargs)
    except anthropic.AuthenticationError as e:
        last_error = "authentication failed"
        raise LLMError(last_error) from e
    except anthropic.RateLimitError as e:
        last_error = "rate limited"
        raise LLMError(last_error) from e
    except anthropic.BadRequestError as e:
        last_error = f"bad request: {e.message}"
        raise LLMError(last_error) from e
    except anthropic.APIStatusError as e:
        last_error = f"API error {e.status_code}"
        raise LLMError(last_error) from e
    except anthropic.APIConnectionError as e:  # includes timeouts
        last_error = "connection error or timeout"
        raise LLMError(last_error) from e

    if response.stop_reason == "refusal":
        last_error = "request declined"
        raise LLMError(last_error)
    if response.stop_reason == "max_tokens":
        last_error = "output truncated"
        raise LLMError(last_error)
    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        last_error = "empty response"
        raise LLMError(last_error)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        last_error = "invalid JSON"
        raise LLMError(last_error) from e
    if not isinstance(data, dict):
        last_error = "JSON is not an object"
        raise LLMError(last_error)
    last_error = None
    return data


# ---------------------------------------------------------------- Gemini (Google AI Studio key)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
_http: httpx.AsyncClient | None = None


def _parse(text: str | None) -> dict[str, Any]:
    global last_error
    if not text:
        last_error = "empty response"
        raise LLMError(last_error)
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        last_error = "invalid JSON"
        raise LLMError(last_error) from e
    if not isinstance(data, dict):
        last_error = "JSON is not an object"
        raise LLMError(last_error)
    last_error = None
    return data


async def _gemini_json(system: str, prompt: str, schema: dict, *, effort: str, max_tokens: int) -> dict[str, Any]:
    """Same contract as the Claude path: JSON matching `schema` (structured output), or LLMError."""
    global _http, last_error
    if _http is None:
        _http = httpx.AsyncClient(timeout=config.LLM_TIMEOUT_S)
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseJsonSchema": schema,
                             "maxOutputTokens": max_tokens,
                             "thinkingConfig": {"thinkingLevel": "low" if effort == "low" else "high"}},
    }
    models = [config.LLM_MODEL] + [m for m in config.GEMINI_FALLBACK_MODELS if m != config.LLM_MODEL]
    for model in models:  # a rate-limited model hands the request to the next one
        try:
            r = await _http.post(GEMINI_URL.format(model=model), json=body,
                                 headers={"x-goog-api-key": config.GEMINI_API_KEY})
        except httpx.HTTPError as e:  # includes timeouts
            last_error = "connection error or timeout"
            raise LLMError(last_error) from e
        if r.status_code != 429:
            break
        log.info("gemini model %s rate limited, trying the next one", model)
    if r.status_code in (401, 403):
        last_error = "authentication failed"
        raise LLMError(last_error)
    if r.status_code == 429:
        last_error = "rate limited"
        raise LLMError(last_error)
    if r.status_code == 400:
        last_error = f"bad request: {r.text[:200]}"
        raise LLMError(last_error)
    if r.status_code != 200:
        last_error = f"API error {r.status_code}"
        raise LLMError(last_error)
    data = r.json()
    if (data.get("promptFeedback") or {}).get("blockReason"):
        last_error = "request declined"
        raise LLMError(last_error)
    cand = (data.get("candidates") or [{}])[0]
    finish = cand.get("finishReason")
    if finish == "MAX_TOKENS":
        last_error = "output truncated"
        raise LLMError(last_error)
    if finish not in (None, "STOP"):
        last_error = "request declined"
        raise LLMError(last_error)
    parts = (cand.get("content") or {}).get("parts") or []
    return _parse("".join(p.get("text", "") for p in parts if not p.get("thought")))

