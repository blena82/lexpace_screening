"""The trained LexPace logistic-regression model (scikit-learn), as a ScreeningClassifier.

The model was trained on simulated students (LexPace_Generate_and_Train.ipynb) with its own
129 aggregated columns (word_recognition_accuracy, sound_lab_level2_rt_sd_s, ...). Those columns are
computed here from the session's raw trial records with the generator's formulas, so the
session's `lexpace.features/v1` vector stays unchanged.

Mapping from this game to the model's skills:
    lexical -> word_recognition, sound -> sound_lab, comprehension -> reading_comprehension,
    spelling -> spelling, number (number_sense / number_fact / calculation) -> number_sense /
    number_facts / calculation, reasoning -> math_reasoning, writing rubric -> writing_*_score.
Childhood history: the learning-history answer for reading / spelling / math, 0 -> "no",
1-3 -> "yes", not sure or skipped -> "unknown". Age is not asked, so it is left missing
(the model's pipeline imputes it).

The artifact is a joblib pickle: only load model files you created or trust. It needs the
scikit-learn version it was saved with (see requirements.txt).
"""

import math
import os
from pathlib import Path
from statistics import mean, pstdev

from .classifier import ClassificationResult, LabelOutput

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "models" / "lexpace_logistic_regression.joblib"
TARGETS = {"reading_difficulty": "reading", "writing_difficulty": "writing", "math_difficulty": "math"}
NAN = float("nan")

# model skill -> how to pick its trials from the session
SKILLS = {
    "word_recognition": lambda t: t["activity"] == "lexical",
    "sound_lab": lambda t: t["activity"] == "sound",
    "reading_comprehension": lambda t: t["activity"] == "comprehension",
    "spelling": lambda t: t["activity"] == "spelling",
    "number_sense": lambda t: t["activity"] == "number" and t.get("skill") == "number_sense",
    "number_facts": lambda t: t["activity"] == "number" and t.get("skill") == "number_fact",
    "calculation": lambda t: t["activity"] == "number" and t.get("skill") == "calculation",
    "math_reasoning": lambda t: t["activity"] == "reasoning",
}
HISTORY = {"childhood_reading_history": "reading", "childhood_writing_history": "spelling", "childhood_math_history": "math"}


def _r(v):
    return round(v, 4)


def _sd(vals):
    return _r(pstdev(vals)) if len(vals) > 1 else NAN


def build_row(session) -> dict:
    """One row with the model's columns, computed like generate_lexpace_dataset.py does."""
    row = {"language": session.language, "age": NAN}
    for col, key in HISTORY.items():
        code = session.history.get(key)
        row[col] = "unknown" if code is None else "no" if code == 0 else "yes"

    for skill, pick in SKILLS.items():
        obs = [{"correct": int(bool(t.get("correct"))), "difficulty": t.get("difficulty") or 1,
                "timed_out": int(bool(t.get("timeout"))), "rt": (t.get("latency_ms") or 0) / 1000}
               for t in session.trials if pick(t)]
        answered = [o["rt"] for o in obs if not o["timed_out"]]
        n = len(obs)
        row[f"{skill}_accuracy"] = _r(sum(o["correct"] for o in obs) / n) if n else NAN
        row[f"{skill}_mean_rt_s"] = _r(mean(answered)) if answered else NAN
        row[f"{skill}_sd_rt_s"] = _sd(answered)
        row[f"{skill}_timeout_rate"] = _r(sum(o["timed_out"] for o in obs) / n) if n else NAN
        row[f"{skill}_mean_difficulty"] = _r(mean(o["difficulty"] for o in obs)) if n else NAN
        row[f"{skill}_difficulty_adjusted_accuracy"] = (
            _r(sum(o["correct"] * o["difficulty"] for o in obs) / sum(o["difficulty"] for o in obs)) if n else NAN)
        for level in (1, 2, 3):
            sub = [o for o in obs if o["difficulty"] == level]
            row[f"{skill}_level{level}_accuracy"] = _r(sum(o["correct"] for o in sub) / len(sub)) if sub else NAN
            row[f"{skill}_level{level}_rt_sd_s"] = _sd([o["rt"] for o in sub if not o["timed_out"]])
            row[f"{skill}_level{level}_count"] = len(sub)

    ev = session.writing_eval or {}
    for k in ("grammar", "punctuation", "organization", "clarity"):
        row[f"writing_{k}_score"] = ev.get(k) if ev.get("status") == "scored" else NAN
    return row


class SklearnModel:
    def __init__(self, path: str | Path):
        import joblib  # heavy imports only when the model is used
        self.artifact = joblib.load(path)
        self.columns = self.artifact["feature_columns"]
        self.targets = self.artifact["targets"]
        self.thresholds = self.artifact.get("thresholds") or [0.5] * len(self.targets)
        assert set(self.targets) == set(TARGETS), f"unexpected model targets: {self.targets}"
        self.name = f"lexpace_logistic_regression ({Path(path).name})"

    def predict(self, features: dict, session=None) -> ClassificationResult:
        if session is None:
            return ClassificationResult(status="error", model=self.name, message="this model needs the session's trial records")
        import pandas as pd
        row = build_row(session)
        missing = [c for c in self.columns if c not in row]
        assert not missing, f"model columns not computed: {missing}"
        frame = pd.DataFrame([[row[c] for c in self.columns]], columns=self.columns)
        probs = [p[0, 1] for p in self.artifact["pipeline"].predict_proba(frame)]
        outputs = {}
        for target, p, cut in zip(self.targets, probs, self.thresholds):
            p = float(p)
            assert not math.isnan(p)
            outputs[TARGETS[target]] = LabelOutput(probability=round(p, 4), positive=p >= cut)
        return ClassificationResult(status="ok", model=self.name, outputs=outputs)


def load() -> SklearnModel:
    """Factory for LEXPACE_CLASSIFIER=screening.sklearn_model:load."""
    return SklearnModel(os.environ.get("LEXPACE_SKLEARN_MODEL") or DEFAULT_PATH)
