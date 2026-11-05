"""Question generation: LLM first (validated), starter bank as fallback.

Each item is stored with a server-side answer key; only the public part goes to the browser.
Number Challenge items are generated in code, so their answers are correct by construction.
"""

import ast
import logging
import operator
import random
import re
import uuid

from . import llm
from .activities import ACTIVITIES, NUMBER_SKILLS, TIME_LIMITS_S
from .bank import BANK
from .textnorm import is_word, localise_digits, norm_text, norm_word, to_western_digits

log = logging.getLogger("lexpace.generator")

LANG_NAME = {"en": "English", "ar": "Modern Standard Arabic"}
LEVEL_NAME = {1: "easy", 2: "medium", 3: "hard"}
DISTRACTOR_TYPES = ["correct", "sound_kept", "wrong_sound_removed", "no_change", "other"]

SYSTEM = (
    "You write items for LexPace, a set of short screening activities for university students "
    "(reading, spelling, written expression and maths). Items must be neutral, unambiguous, "
    "culturally appropriate for university students in the UAE, and free of personal data. "
    "Never mention learning difficulties, disorders or diagnoses. "
    "Return only the JSON object described by the schema."
)


class ValidationError(Exception):
    pass


def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise ValidationError(msg)


# ---------------------------------------------------------------- safe arithmetic

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


def safe_eval(expr: str) -> float:
    """Evaluates + - * / on numbers only. Anything else raises ValidationError."""
    _check(len(expr) <= 60, "expression too long")

    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            right = ev(node.right)
            _check(not (isinstance(node.op, ast.Div) and right == 0), "division by zero")
            return _OPS[type(node.op)](ev(node.left), right)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -ev(node.operand)
        raise ValidationError("unsupported expression")

    try:
        return ev(ast.parse(to_western_digits(expr), mode="eval"))
    except SyntaxError as e:
        raise ValidationError("bad expression") from e


def option_value(option: str, kind: str):
    s = to_western_digits(option)
    if kind == "time":
        m = re.search(r"(\d{1,2}):(\d{2})", s)
        return int(m.group(1)) * 60 + int(m.group(2)) if m else None
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group()) if m else None


def format_minutes(total: float) -> str:
    total = int(round(total)) % (24 * 60)
    return f"{total // 60}:{total % 60:02d}"


# ---------------------------------------------------------------- validators (raise ValidationError)

def _word_len(word: str, lang: str) -> int:
    return len(norm_word(word, lang))


LEXICAL_LEN = {"en": {1: (3, 6), 2: (5, 9), 3: (8, 16)}, "ar": {1: (3, 4), 2: (4, 6), 3: (5, 12)}}


def validate_lexical(d: dict, lang: str, level: int, want_real: bool) -> dict:
    w = str(d.get("stimulus", "")).strip()
    if lang == "en":
        w = w.lower()
    _check(is_word(w, lang), "stimulus must be one word in the language's letters")
    lo, hi = LEXICAL_LEN[lang][level]
    _check(lo <= _word_len(w, lang) <= hi, "stimulus length does not fit the level")
    _check(d.get("is_real_word") is want_real, "real/made-up label does not match the request")
    return {"stimulus": w, "is_real_word": want_real}


def _delete(word: str, letter: str, position: str) -> str | None:
    if position == "initial":
        return word[1:] if word.startswith(letter) else None
    if position == "final":
        return word[:-1] if word.endswith(letter) else None
    i = word.find(letter, 1)
    return word[:i] + word[i + 1:] if 0 < i < len(word) - 1 else None


def validate_sound(d: dict, lang: str, level: int) -> dict:
    word, remove, position = str(d.get("word", "")).strip(), str(d.get("remove", "")).strip(), d.get("position")
    options = [str(o).strip() for o in d.get("options", [])]
    ci = d.get("correct_index")
    _check(is_word(word, lang), "word must be one word")
    _check(position in ("initial", "medial", "final"), "bad position")
    _check(len(norm_word(remove, lang)) == 1, "remove must be one letter/sound")
    _check(len(options) == 3 and all(is_word(o, lang) for o in options), "need 3 one-word options")
    _check(isinstance(ci, int) and 0 <= ci < 3, "bad correct_index")
    normed = [norm_word(o, lang) for o in options]
    _check(len(set(normed)) == 3, "options must differ")
    expected = _delete(norm_word(word, lang), norm_word(remove, lang), position)
    _check(expected is not None and normed[ci] == expected, "correct option is not the word without that sound")
    types = list(d.get("distractor_types", []))
    _check(len(types) == 3 and all(t in DISTRACTOR_TYPES for t in types), "bad distractor_types")
    types[ci] = "correct"
    return {"word": word, "remove": remove, "position": position, "options": options, "correct_index": ci,
            "distractor_types": types}


SPELLING_LEN = {"en": {1: (4, 6), 2: (6, 9), 3: (6, 14)}, "ar": {1: (3, 5), 2: (4, 6), 3: (5, 10)}}


def validate_spelling(d: dict, lang: str, level: int) -> dict:
    word = str(d.get("word", "")).strip()
    spoken = str(d.get("spoken", "")).strip() or word
    if lang == "en":
        word = spoken = word.lower()
    _check(is_word(word, lang) and is_word(spoken, lang), "word must be one word")
    _check(norm_word(spoken, lang) == norm_word(word, lang), "spoken form must be the same word")
    lo, hi = SPELLING_LEN[lang][level]
    _check(lo <= _word_len(word, lang) <= hi, "word length does not fit the level")
    return {"word": word, "spoken": spoken}


def validate_comprehension(d: dict, lang: str, level: int) -> dict:
    passage = str(d.get("passage", "")).strip()
    n_words = len(passage.split())
    _check(50 <= n_words <= 140, "passage length out of range")
    _check("<" not in passage and ">" not in passage, "no markup")
    qs = d.get("questions", [])
    _check(len(qs) == 4, "need 4 questions")
    out = []
    for q in qs:
        opts = [str(o).strip() for o in q.get("options", [])]
        ci = q.get("correct_index")
        _check(str(q.get("question", "")).strip() != "", "empty question")
        _check(len(opts) == 3 and all(opts) and len({norm_text(o) for o in opts}) == 3, "need 3 distinct options")
        _check(isinstance(ci, int) and 0 <= ci < 3, "bad correct_index")
        out.append({"question": str(q["question"]).strip(), "options": opts, "correct_index": ci})
    _check(len({norm_text(q["question"]) for q in out}) == 4, "questions repeat")
    return {"passage": passage, "questions": out}


def validate_reasoning(d: dict, lang: str, level: int) -> dict:
    question = str(d.get("question", "")).strip()
    kind = d.get("answer_kind")
    options = [str(o).strip() for o in d.get("options", [])]
    ci = d.get("correct_index")
    _check(question != "" and re.search(r"[0-9٠-٩]", question) is not None, "question needs numbers")
    _check(kind in ("number", "time"), "bad answer_kind")
    _check(len(options) == 3 and isinstance(ci, int) and 0 <= ci < 3, "need 3 options and a valid index")
    value = safe_eval(str(d.get("expression", "")))
    vals = [option_value(o, kind) for o in options]
    _check(all(v is not None for v in vals), "every option needs a value")
    target = round(value) % (24 * 60) if kind == "time" else value
    matches = [i for i, v in enumerate(vals) if abs(v - target) < 1e-9]
    _check(matches == [ci], "exactly one option must equal the computed answer, at correct_index")
    return {"question": question, "expression": str(d["expression"]), "answer_kind": kind,
            "options": options, "correct_index": ci}


# ---------------------------------------------------------------- prompts + schemas

S, I, B = {"type": "string"}, {"type": "integer"}, {"type": "boolean"}
SCHEMAS = {
    "lexical": llm.obj({"stimulus": S, "is_real_word": B}),
    "sound": llm.obj({"word": S, "remove": S, "position": {"type": "string", "enum": ["initial", "medial", "final"]},
                      "options": {"type": "array", "items": S}, "correct_index": I,
                      "distractor_types": {"type": "array", "items": {"type": "string", "enum": DISTRACTOR_TYPES}}}),
    "spelling": llm.obj({"word": S, "spoken": S}),
    "comprehension": llm.obj({"passage": S, "questions": {"type": "array", "items": llm.obj(
        {"question": S, "options": {"type": "array", "items": S}, "correct_index": I})}}),
    "reasoning": llm.obj({"question": S, "expression": S, "answer_kind": {"type": "string", "enum": ["number", "time"]},
                          "options": {"type": "array", "items": S}, "correct_index": I}),
}


def _avoid(used: list[str]) -> str:
    return ("Do not reuse or closely imitate any of these earlier items: " + "; ".join(used[-20:]) + ".") if used else ""


def build_prompt(activity: str, lang: str, level: int, used: list[str], want_real: bool | None) -> str:
    L, lvl = LANG_NAME[lang], LEVEL_NAME[level]
    example = next((x for x in BANK[lang][activity] if x["difficulty"] == level), BANK[lang][activity][0])
    ex = {k: v for k, v in example.items() if k != "difficulty"}
    if activity == "lexical":
        kind = ("a real, common " + L + " word" if want_real else
                "a made-up pseudo-word that follows " + L + " spelling" + (" and root-pattern" if lang == "ar" else "") +
                " rules but is not a word in any dictionary")
        task = (f"Lexical decision item, {lvl} level. Give {kind}. Easy = short and frequent; medium = longer; "
                f"hard = long, low-frequency or morphologically complex. One word, letters only"
                + (", with full diacritics (tashkeel)" if lang == "ar" else ", lower case") + f". Set is_real_word to {str(want_real).lower()}.")
    elif activity == "sound":
        task = (f"Phoneme deletion item ({L}), {lvl} level. Give a short {'pseudo-word or ' if lang == 'en' else ''}word, "
                "one letter/sound to remove at the stated position, and 3 one-word spoken answer options. "
                "The correct option must be exactly the word with that one letter removed. Distractors: keep the removed "
                "sound, remove a different sound, or leave the word unchanged; label each in distractor_types. "
                "Easy = initial sound in a 3-letter word; medium = final sound; hard = a medial sound or a consonant cluster.")
    elif activity == "spelling":
        task = (f"Spelling-to-dictation item ({L}), {lvl} level. Give one real word to dictate. "
                "Easy = common and regular; medium = less common or with a tricky letter pattern; hard = irregular or rarely seen. "
                + ("'word' is the correct spelling without diacritics, 'spoken' is the same word with full diacritics for speech."
                   if lang == "ar" else "'spoken' repeats the word."))
    elif activity == "comprehension":
        task = (f"Reading comprehension set in {L}, {lvl} level: one factual passage of 70-110 words about university or "
                "everyday life, and 4 multiple-choice questions, each with 3 options and exactly one correct answer that "
                "is stated in the passage. Easy = simple sentences; hard = longer sentences and one inference question.")
    else:  # reasoning
        task = (f"Maths word problem in {L}, {lvl} level, answerable in under 40 seconds without a calculator. "
                "Give 'expression': the arithmetic that computes the answer, using only digits, + - * / and parentheses "
                "(for clock times, compute in minutes since midnight and set answer_kind to 'time', options as H:MM). "
                "Give 3 options; exactly one equals the answer and the others are plausible mistakes. "
                "Easy = one step; medium = two steps; hard = two or three steps, or time/units."
                + (" Write numbers in the question and options with Arabic-Indic digits (٠-٩); the expression uses 0-9." if lang == "ar" else ""))
    return f"{task}\n{_avoid(used)}\nFormat example (do not copy): {ex}"


VALIDATORS = {"lexical": validate_lexical, "sound": validate_sound, "spelling": validate_spelling,
              "comprehension": validate_comprehension, "reasoning": validate_reasoning}
SIGNATURE = {  # what counts as "the same item" for repetition checks
    "lexical": lambda k: k["stimulus"], "sound": lambda k: k["word"], "spelling": lambda k: k["word"],
    "comprehension": lambda k: k["passage"][:80], "reasoning": lambda k: k["question"],
    "writing": lambda k: k["prompt"], "number": lambda k: k["question"],
}


# ---------------------------------------------------------------- number challenge (deterministic)

def make_number_item(skill: str, level: int, lang: str, rng: random.Random) -> dict:
    if skill == "number_sense":
        if rng.random() < 0.5:
            hi = {1: 99, 2: 999, 3: 9999}[level]
            a = rng.randint(hi // 10 + 1, hi)
            b = int(str(a)[::-1]) if level == 1 and a % 10 and str(a) != str(a)[::-1] else a + rng.choice([-1, 1]) * rng.randint(1, max(2, hi // 20))
            q = {"en": "Which number is greater?", "ar": "أي العددين أكبر؟"}[lang]
            opts = [str(a), str(b), {"en": "Equal", "ar": "متساويان"}[lang]]
            ci = 0 if a > b else 1 if b > a else 2
        else:
            target = {1: 50, 2: 500, 3: 5000}[level]
            spread = {1: 25, 2: 250, 3: 2500}[level]
            close = target + rng.choice([-1, 1]) * rng.randint(1, spread // 10)
            far = [target + spread - rng.randint(0, spread // 5), target - spread + rng.randint(0, spread // 5)]
            opts_n = [close] + far
            rng.shuffle(opts_n)
            q = {"en": f"Which number is closest to {target}?", "ar": f"أي عدد أقرب إلى {target}؟"}[lang]
            opts, ci = [str(n) for n in opts_n], opts_n.index(close)
    elif skill == "number_fact":
        a, b = rng.randint(2, {1: 5, 2: 9, 3: 9}[level]), rng.randint(2, 9)
        op = "+" if level == 1 else rng.choice(["+", "×"]) if level == 2 else "×"
        ans = a + b if op == "+" else a * b
        q = {"en": f"What is {a} {op} {b}?", "ar": f"كم يساوي {a} {op} {b}؟"}[lang]
        wrong = [ans - 1, ans + 1] if op == "+" else [ans - b, ans + b]
        opts_n = [ans] + wrong
        rng.shuffle(opts_n)
        opts, ci = [str(n) for n in opts_n], opts_n.index(ans)
    else:  # calculation
        lo, hi = {1: (11, 49), 2: (21, 99), 3: (101, 499)}[level]
        a, b = rng.randint(lo, hi), rng.randint(lo, hi)
        if rng.random() < 0.5:
            op, ans = "+", a + b
        else:
            a, b = max(a, b), min(a, b)
            op, ans = "−", a - b
        q = {"en": f"Calculate: {a} {op} {b}", "ar": f"احسب: {a} {op} {b}"}[lang]
        wrong = [ans + 10, ans - 10] if rng.random() < 0.5 else [ans + 10, ans - 2]
        opts_n = [ans] + [w for w in wrong if w != ans]
        rng.shuffle(opts_n)
        opts, ci = [str(n) for n in opts_n], opts_n.index(ans)
    if len({o for o in opts}) != 3:  # rare collision: retry with a fresh draw
        return make_number_item(skill, level, lang, rng)
    return {"question": localise_digits(q, lang), "options": [localise_digits(o, lang) for o in opts], "correct_index": ci}


# ---------------------------------------------------------------- main entry

def _from_bank(activity: str, lang: str, level: int, used: set[str]) -> tuple[dict, int]:
    items = BANK[lang][activity]
    for lvl in sorted({x["difficulty"] for x in items}, key=lambda l: abs(l - level)):
        for x in items:
            key = {k: v for k, v in x.items() if k != "difficulty"}
            if x["difficulty"] == lvl and norm_text(SIGNATURE[activity](key)) not in used:
                return key, lvl
    x = items[0]  # bank exhausted (cannot happen with the default trial counts)
    return {k: v for k, v in x.items() if k != "difficulty"}, x["difficulty"]


async def generate(session, activity: str, level: int, trial: int) -> dict:
    """Returns an internal item: {item_id, activity, trial, difficulty, skill, source, key, public}."""
    lang = session.language
    used = session.used.setdefault(activity, set())
    used_list = session.used_list.setdefault(activity, [])
    skill = ACTIVITIES[activity]["skill"]
    source, key, difficulty = "bank", None, level

    if activity == "number":
        skill = NUMBER_SKILLS[trial]
        for _ in range(20):
            key = make_number_item(skill, level, lang, session.rng)
            if norm_text(key["question"]) not in used:
                break
        source = "rules"
    elif activity == "writing":
        key, difficulty = _from_bank("writing", lang, level, set())
    else:
        if llm.enabled():
            want_real = None
            if activity == "lexical":  # balanced real / made-up words, in random order
                plan = session.lexical_plan
                want_real = plan[trial]
            for attempt in range(2):
                try:
                    data = await llm.generate_json(SYSTEM, build_prompt(activity, lang, level, used_list, want_real),
                                                   SCHEMAS[activity], effort="low",
                                                   max_tokens=8000 if activity == "comprehension" else 4000)
                    args = (data, lang, level, want_real) if activity == "lexical" else (data, lang, level)
                    candidate = VALIDATORS[activity](*args)
                    _check(norm_text(SIGNATURE[activity](candidate)) not in used, "repeats an earlier item")
                    key, source = candidate, "llm"
                    break
                except (llm.LLMError, ValidationError) as e:
                    log.warning("generation %s/%s attempt %d rejected: %s", activity, lang, attempt + 1, e)
                    if isinstance(e, llm.LLMError):
                        break  # API problem: don't retry, use the bank
        if key is None:
            key, difficulty = _from_bank(activity, lang, level, used)

    sig = norm_text(SIGNATURE[activity](key))
    used.add(sig)
    used_list.append(SIGNATURE[activity](key)[:60])
    return {"item_id": uuid.uuid4().hex, "activity": activity, "trial": trial, "difficulty": difficulty,
            "skill": skill, "source": source, "key": key, "public": public_view(activity, key, skill)}


def public_view(activity: str, key: dict, skill: str) -> dict:
    """What the browser may see: never the correct answer (except words that must be spoken aloud)."""
    if activity == "lexical":
        return {"stimulus": key["stimulus"]}
    if activity == "sound":
        return {"word": key["word"], "remove": key["remove"], "options": key["options"]}
    if activity == "spelling":
        return {"spoken": key["spoken"]}  # browser speech needs the word itself
    if activity == "writing":
        return {"prompt": key["prompt"]}
    if activity == "comprehension":
        return {"passage": key["passage"], "questions": [{"question": q["question"], "options": q["options"]} for q in key["questions"]]}
    out = {"question": key["question"], "options": key["options"]}
    if activity in ("number", "reasoning"):
        out["time_limit_s"] = TIME_LIMITS_S[skill]
    return out
