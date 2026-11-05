"""HTTP API for the adaptive screening games (mounted under /api/screening)."""

import asyncio
import logging
from typing import Callable, Literal, Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import classifier, config, evaluation, features, generator, llm, store
from .activities import ACTIVITIES, next_level, number_fast_ms

log = logging.getLogger("lexpace.screening")
Activity = Literal["lexical", "sound", "spelling", "writing", "comprehension", "number", "reasoning"]


class StartIn(BaseModel):
    language: Literal["en", "ar"]
    context: dict = Field(default_factory=dict)


class ItemIn(BaseModel):
    activity: Activity


class AnswerIn(BaseModel):
    item_id: str
    response: Union[int, str, None] = None   # option index, typed word or written text
    latency_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)
    timeout: bool = False
    question_index: Optional[int] = Field(default=None, ge=0, le=3)
    audio_plays: Optional[int] = Field(default=None, ge=0, le=1000)
    lookbacks: Optional[int] = Field(default=None, ge=0, le=1000)


class CompleteIn(BaseModel):
    history: dict[str, Optional[int]] = Field(default_factory=dict)  # 0-3, None = not sure
    passage_reading_ms: Optional[int] = Field(default=None, ge=0, le=3_600_000)


def _session(session_id: str) -> store.Session:
    s = store.get(session_id)
    if s is None:
        raise HTTPException(404, "Unknown or expired screening session")
    return s


def _comprehension_level(s: store.Session) -> int:
    """Passage difficulty follows the reading accuracy so far (lexical + spelling)."""
    done = [t for t in s.trials if t["activity"] in ("lexical", "spelling") and t.get("correct") is not None]
    if not done:
        return 2
    acc = sum(t["correct"] for t in done) / len(done)
    return 1 if acc < 0.5 else 2 if acc < 0.85 else 3


def create_router(on_result: Callable[[dict], None] | None = None) -> APIRouter:
    """on_result(classification) is called after every completed session (e.g. to save the lesson version);
    classification["status"] says whether a trained model produced outputs."""
    r = APIRouter(prefix="/api/screening", tags=["screening"])

    @r.get("/status")
    def status():
        return {"llm_enabled": llm.enabled(), "llm_model": config.LLM_MODEL if llm.enabled() else None,
                "llm_last_error": llm.last_error, "classifier": type(classifier.load_classifier()).__name__,
                "feature_version": features.FEATURE_VERSION, "feature_names": features.FEATURE_NAMES}

    @r.post("/sessions")
    def start(body: StartIn):
        context = {k: v for k, v in body.context.items() if isinstance(v, (str, bool, int)) and len(str(v)) <= 100}
        s = store.create(body.language, context)
        return {"session_id": s.id, "language": s.language, "llm_enabled": llm.enabled(),
                "plan": {a: v["trials"] for a, v in ACTIVITIES.items()}}

    @r.post("/sessions/{session_id}/items")
    async def next_item(session_id: str, body: ItemIn):
        s = _session(session_id)
        a = body.activity
        async with s.lock:
            if s.counts[a] >= ACTIVITIES[a]["trials"]:
                raise HTTPException(409, f"All {a} items for this session have been served")
            level = _comprehension_level(s) if a == "comprehension" else s.levels[a]
            item = await generator.generate(s, a, level, s.counts[a])
            s.items[item["item_id"]] = item
            s.counts[a] += 1
            if a == "comprehension":
                s.extra["passage_words"] = len(item["key"]["passage"].split())
        return {"item_id": item["item_id"], "activity": a, "trial": item["trial"], "difficulty": item["difficulty"],
                "skill": item["skill"], "source": item["source"], **item["public"]}

    @r.post("/sessions/{session_id}/answers")
    async def answer(session_id: str, body: AnswerIn):
        s = _session(session_id)
        item = s.items.get(body.item_id)
        if item is None:
            raise HTTPException(404, "Unknown item")
        a = item["activity"]
        if a == "comprehension" and body.question_index is None:
            raise HTTPException(422, "question_index is required for comprehension")
        key = (body.item_id, body.question_index if a == "comprehension" else None)
        if key in s.answered:
            raise HTTPException(409, "Already answered")
        if isinstance(body.response, str) and len(body.response) > 1500:
            raise HTTPException(422, "Response too long")
        if a in ("writing", "spelling") and not isinstance(body.response, (str, type(None))):
            raise HTTPException(422, "Text response expected")
        if a not in ("writing", "spelling") and isinstance(body.response, str):
            raise HTTPException(422, "Option index expected")
        s.answered.add(key)

        result = evaluation.evaluate(item, body.response, body.latency_ms, body.timeout, body.question_index, s.language)
        trial = {"activity": a, "item_id": body.item_id, "trial": item["trial"], "difficulty": item["difficulty"],
                 "skill": item["skill"], "source": item["source"], "latency_ms": body.latency_ms,
                 "response": body.response, "audio_plays": body.audio_plays, "lookbacks": body.lookbacks,
                 "question_index": body.question_index, **result}
        s.trials.append(trial)

        if a == "writing":
            prompt = item["key"]["prompt"]
            s.writing_task = asyncio.create_task(evaluation.score_writing(prompt, str(body.response or ""), s.language))
        elif a in ("lexical", "sound", "spelling", "reasoning", "number"):
            fast = number_fast_ms(item["skill"]) if a == "number" else ACTIVITIES[a]["fast_ms"]
            s.levels[a] = next_level(s.levels[a], result["correct"], body.latency_ms, fast, result.get("timeout", False))
        return {"correct": result["correct"], "timeout": result.get("timeout", False)}

    @r.post("/sessions/{session_id}/complete")
    async def complete(session_id: str, body: CompleteIn):
        s = _session(session_id)
        if s.result is None:
            s.history = {k: v for k, v in body.history.items() if k in features.HISTORY_KEYS and (v is None or 0 <= v <= 3)}
            if body.passage_reading_ms is not None:
                s.extra["passage_reading_ms"] = body.passage_reading_ms
            if s.writing_task is not None:
                try:
                    s.writing_eval = await asyncio.wait_for(s.writing_task, timeout=config.LLM_TIMEOUT_S + 15)
                except Exception as e:  # timeout or unexpected failure: keep going without a score
                    s.writing_eval = {"status": "not_scored", "reason": f"evaluation failed: {type(e).__name__}"}
            vector = features.extract(s)
            result = classifier.classify(vector, session=s)
            # DEMO ONLY (remove before merging): a "Skip to end" session gets sample results when no model is connected.
            if s.context.get("demo") is True and result.get("status") != "ok":
                result = {"status": "ok", "model": "demo-sample", "message": "Sample results for a demo",
                          "feature_version": features.FEATURE_VERSION,
                          "outputs": {"reading": {"probability": 0.26, "positive": False},
                                      "writing": {"probability": 0.68, "positive": True},
                                      "math": {"probability": 0.34, "positive": False}}}
            s.result = {"features": vector, "classification": result}
            s.result["saved_as"] = store.save(s)
            if on_result:
                try:
                    on_result(result)
                except Exception:
                    log.exception("on_result hook failed")
        return {"session_id": s.id, "feature_version": features.FEATURE_VERSION,
                "features": s.result["features"], "classification": s.result["classification"],
                "writing_eval": s.writing_eval}

    return r
