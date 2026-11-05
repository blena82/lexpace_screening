"""The seven screening activities and their fixed settings.

Trial counts and maths time limits match the original EN/AR games
(lexpace_games_timed_en.html / _ar.html). Difficulty is 1 (easy) to 3 (hard).
"""

LEVELS = (1, 2, 3)
START_LEVEL = 1

ACTIVITIES = {
    # id: trials per session, "fast" response time (ms) used by the adaptive rule
    "lexical":       {"trials": 6, "fast_ms": 3000,  "skill": "lexical_decision", "domain": "reading"},
    "sound":         {"trials": 3, "fast_ms": 9000,  "skill": "phoneme_deletion", "domain": "reading"},
    "spelling":      {"trials": 3, "fast_ms": 12000, "skill": "spelling_to_dictation", "domain": "writing"},
    "writing":       {"trials": 1, "fast_ms": None,  "skill": "written_expression", "domain": "writing"},
    "comprehension": {"trials": 1, "fast_ms": None,  "skill": "reading_comprehension", "domain": "reading",
                      "questions": 4},
    "number":        {"trials": 6, "fast_ms": None,  "skill": None, "domain": "math"},
    "reasoning":     {"trials": 3, "fast_ms": 20000, "skill": "math_reasoning", "domain": "math"},
}

# Number Challenge keeps the original order of skills: 2 x number sense, 2 x facts, 2 x calculation.
NUMBER_SKILLS = ["number_sense", "number_sense", "number_fact", "number_fact", "calculation", "calculation"]

# Existing time limits (seconds) of the timed maths activities.
TIME_LIMITS_S = {"number_sense": 8, "number_fact": 10, "calculation": 25, "math_reasoning": 40}
TIMEOUT_GRACE_MS = 1500  # network/render slack before a late answer counts as a timeout


def number_fast_ms(skill: str) -> int:
    """Number Challenge: an answer in under half the time limit counts as fast."""
    return TIME_LIMITS_S[skill] * 1000 // 2


def next_level(level: int, correct: bool | None, latency_ms: int | None, fast_ms: int | None, timeout: bool) -> int:
    """Adaptive staircase: fast + correct -> harder, wrong or timed out -> easier, otherwise stay."""
    if timeout or correct is False:
        return max(LEVELS[0], level - 1)
    if correct and fast_ms is not None and latency_ms is not None and latency_ms <= fast_ms:
        return min(LEVELS[-1], level + 1)
    return level
