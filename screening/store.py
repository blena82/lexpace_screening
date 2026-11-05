"""In-memory screening sessions (one per student run). Completed sessions are also written to disk."""

import asyncio
import json
import random
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field

from . import config
from .activities import ACTIVITIES, START_LEVEL


@dataclass
class Session:
    language: str
    context: dict
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    created: float = field(default_factory=time.time)
    levels: dict = field(default_factory=lambda: {a: START_LEVEL for a in ACTIVITIES})
    counts: dict = field(default_factory=lambda: {a: 0 for a in ACTIVITIES})
    items: dict = field(default_factory=dict)        # item_id -> internal item (with answer key)
    answered: set = field(default_factory=set)       # (item_id, question_index)
    trials: list = field(default_factory=list)       # one record per answer
    used: dict = field(default_factory=dict)         # activity -> normalised signatures (no repeats)
    used_list: dict = field(default_factory=dict)    # activity -> short texts shown to the LLM
    history: dict = field(default_factory=dict)
    extra: dict = field(default_factory=dict)
    writing_eval: dict | None = None
    writing_task: asyncio.Task | None = None
    result: dict | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    rng: random.Random = field(default_factory=random.Random)
    lexical_plan: list = field(default_factory=list)

    def __post_init__(self):
        n = ACTIVITIES["lexical"]["trials"]
        self.lexical_plan = [True] * (n // 2) + [False] * (n - n // 2)
        self.rng.shuffle(self.lexical_plan)

    def record(self) -> dict:
        """What is saved for model training: no answer keys, no LLM internals."""
        return {"session_id": self.id, "language": self.language, "context": self.context,
                "created": self.created, "completed": time.time(), "history": self.history,
                "extra": self.extra, "trials": self.trials, "writing_eval": self.writing_eval,
                **(self.result or {})}


_sessions: "OrderedDict[str, Session]" = OrderedDict()


def create(language: str, context: dict) -> Session:
    s = Session(language=language, context=context)
    _sessions[s.id] = s
    while len(_sessions) > config.MAX_LIVE_SESSIONS:
        _sessions.popitem(last=False)
    return s


def get(session_id: str) -> Session | None:
    return _sessions.get(session_id)


def save(session: Session) -> str:
    config.SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    path = config.SESSIONS_DIR / f"{session.id}.json"
    path.write_text(json.dumps(session.record(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path.name
