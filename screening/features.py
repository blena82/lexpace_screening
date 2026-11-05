"""Feature extraction: trial records -> one fixed-order feature vector per session.

Skill-level features are kept separate (no single overall score). Missing values are None,
so the trained model (or its preprocessing) decides how to impute them.
"""

from statistics import mean, median

FEATURE_VERSION = "lexpace.features/v1"
HISTORY_KEYS = ("reading", "spelling", "math", "support", "persistent")
NUMBER_SKILLS = ("number_sense", "number_fact", "calculation")


def _acc(trials):
    scored = [t for t in trials if t.get("correct") is not None]
    return round(sum(bool(t["correct"]) for t in scored) / len(scored), 4) if scored else None


def _rt(trials):
    rts = [t["latency_ms"] for t in trials if t.get("latency_ms") is not None and not t.get("timeout")]
    return round(median(rts)) if rts else None


def _lvl(trials, fn=mean):
    lv = [t["difficulty"] for t in trials if t.get("difficulty") is not None]
    return round(fn(lv), 3) if lv else None


def _count(trials, key, value=None):
    return sum(1 for t in trials if (t.get(key) == value if value is not None else bool(t.get(key))))


def _avg(trials, key):
    v = [t[key] for t in trials if t.get(key) is not None]
    return round(mean(v), 4) if v else None


def _sum(trials, key):
    v = [t[key] for t in trials if t.get(key) is not None]
    return sum(v) if v else None


def extract(session) -> dict:
    by = lambda a: [t for t in session.trials if t["activity"] == a]
    lex, snd, spl, cmp_, num, rsn = by("lexical"), by("sound"), by("spelling"), by("comprehension"), by("number"), by("reasoning")
    w = (by("writing") or [{}])[-1]
    ev = session.writing_eval or {}
    f: dict = {}

    f["assessment_language_ar"] = 1 if session.language == "ar" else 0

    # Real or Not? (lexical decision)
    f["lexical_n"] = len(lex)
    f["lexical_acc"] = _acc(lex)
    f["lexical_acc_real"] = _acc([t for t in lex if t.get("is_real_word")])
    f["lexical_acc_pseudo"] = _acc([t for t in lex if t.get("is_real_word") is False])
    f["lexical_false_alarms"] = _count(lex, "error_type", "false_alarm")
    f["lexical_misses"] = _count(lex, "error_type", "miss")
    f["lexical_rt_median_ms"] = _rt(lex)
    f["lexical_level_mean"] = _lvl(lex)
    f["lexical_level_max"] = _lvl(lex, max)

    # Sound Lab (phoneme deletion)
    f["sound_n"] = len(snd)
    f["sound_acc"] = _acc(snd)
    f["sound_rt_median_ms"] = _rt(snd)
    f["sound_level_mean"] = _lvl(snd)
    f["sound_level_max"] = _lvl(snd, max)
    for e in ("sound_kept", "wrong_sound_removed", "no_change", "other"):
        f[f"sound_err_{e}"] = _count(snd, "error_type", e)
    f["sound_audio_plays_mean"] = _avg(snd, "audio_plays")

    # Echo (spelling to dictation)
    f["spelling_n"] = len(spl)
    f["spelling_acc"] = _acc(spl)
    f["spelling_rt_median_ms"] = _rt(spl)
    f["spelling_level_mean"] = _lvl(spl)
    f["spelling_level_max"] = _lvl(spl, max)
    f["spelling_edit_distance_mean"] = _avg(spl, "edit_distance_norm")
    for e in ("omissions", "insertions", "substitutions", "transpositions"):
        f[f"spelling_err_{e}"] = _sum(spl, f"err_{e}")
    f["spelling_audio_plays_mean"] = _avg(spl, "audio_plays")

    # Express Your Idea (written expression)
    f["writing_words"] = w.get("words")
    f["writing_sentences"] = w.get("sentences")
    f["writing_mean_sentence_len"] = w.get("mean_sentence_len")
    f["writing_punctuation_marks"] = w.get("punctuation_marks")
    f["writing_time_ms"] = w.get("latency_ms")
    f["writing_scored"] = 1 if ev.get("status") == "scored" else 0
    for k in ("grammar", "punctuation", "organization", "clarity", "grammar_errors", "punctuation_errors", "spelling_errors"):
        f[f"writing_{k}"] = ev.get(k) if ev.get("status") == "scored" else None

    # Read & Listen (comprehension)
    reading_ms = session.extra.get("passage_reading_ms")
    passage_words = session.extra.get("passage_words")
    f["comp_n"] = len(cmp_)
    f["comp_acc"] = _acc(cmp_)
    f["comp_rt_median_ms"] = _rt(cmp_)
    f["comp_reading_ms"] = reading_ms
    f["comp_wpm"] = round(passage_words / (reading_ms / 60000), 1) if reading_ms and passage_words else None
    f["comp_lookbacks"] = max((t.get("lookbacks") or 0 for t in cmp_), default=None) if cmp_ else None
    f["comp_level"] = _lvl(cmp_)

    # Number Challenge (timed), per skill
    for s in NUMBER_SKILLS:
        ts = [t for t in num if t.get("skill") == s]
        f[f"math_{s}_acc"] = _acc(ts)
        f[f"math_{s}_rt_median_ms"] = _rt(ts)
        f[f"math_{s}_timeouts"] = _count(ts, "timeout") if ts else None
    f["math_number_level_mean"] = _lvl(num)

    # Math Reasoning (timed)
    f["math_reasoning_acc"] = _acc(rsn)
    f["math_reasoning_rt_median_ms"] = _rt(rsn)
    f["math_reasoning_timeouts"] = _count(rsn, "timeout") if rsn else None
    f["math_reasoning_level_mean"] = _lvl(rsn)

    # Learning history (0 = no difficulty ... 3 = a lot; None = not sure / skipped)
    for k in HISTORY_KEYS:
        f[f"history_{k}"] = session.history.get(k)
    return f


FEATURE_NAMES: list[str] = []  # filled once below from a dummy session, so the order is defined in one place


class _Dummy:
    language, trials, writing_eval, extra, history = "en", [], None, {}, {}


FEATURE_NAMES.extend(extract(_Dummy()).keys())
