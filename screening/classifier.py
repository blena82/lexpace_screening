"""Classification service: feature vector -> three independent (multi-label) screening outputs.

    reading    reading difficulties
    writing    written-expression difficulties
    math       mathematics difficulties

This module contains NO decision rules and never uses the LLM. Until a trained model is
connected it returns status "model_not_connected" with no outputs.

The bundled trained model (backend/models/lexpace_logistic_regression.joblib, see sklearn_model.py)
is used by default. LEXPACE_CLASSIFIER=none turns it off.

Connecting another trained model (either option):
  1. LEXPACE_CLASSIFIER_MODEL=path/to/model.json - a multi-label logistic export:
       {"labels": ["reading","writing","math"], "features": [...feature names...],
        "mean": [...], "scale": [...], "coef": [[...] per label], "intercept": [...],
        "thresholds": [0.5, 0.5, 0.5], "fill": [...optional impute values...], "version": "..."}
  2. LEXPACE_CLASSIFIER=package.module:factory - any Python object with
       predict(features: dict, session=None) -> ClassificationResult (e.g. a wrapped scikit-learn
       pipeline; `session` gives access to the raw trial records).
"""

import importlib
import json
import logging
import math
from dataclasses import asdict, dataclass, field
from typing import Protocol

from . import config
from .features import FEATURE_NAMES, FEATURE_VERSION

log = logging.getLogger("lexpace.classifier")
LABELS = ("reading", "writing", "math")


@dataclass
class LabelOutput:
    probability: float
    positive: bool


@dataclass
class ClassificationResult:
    status: str                      # "ok" | "model_not_connected" | "error"
    model: str | None = None         # model name/version, for the record
    outputs: dict[str, LabelOutput] = field(default_factory=dict)  # one entry per label, independent
    message: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class ScreeningClassifier(Protocol):
    def predict(self, features: dict, session=None) -> ClassificationResult: ...


class UnconfiguredClassifier:
    def predict(self, features: dict, session=None) -> ClassificationResult:
        return ClassificationResult(status="model_not_connected",
                                    message="No trained model is connected yet. Features were saved for review.")


class JsonLogisticClassifier:
    """Multi-label logistic regression exported to JSON: one independent sigmoid per label."""

    def __init__(self, path: str):
        with open(path, encoding="utf-8") as fh:
            m = json.load(fh)
        self.labels = m["labels"]
        assert set(self.labels) <= set(LABELS), f"labels must be among {LABELS}"
        self.features, self.mean, self.scale = m["features"], m["mean"], m["scale"]
        self.coef, self.intercept = m["coef"], m["intercept"]
        self.thresholds = m.get("thresholds", [0.5] * len(self.labels))
        self.fill = m.get("fill", self.mean)
        self.name = m.get("version", path)
        missing = [f for f in self.features if f not in FEATURE_NAMES]
        assert not missing, f"model expects unknown features: {missing}"

    def predict(self, features: dict, session=None) -> ClassificationResult:
        x = []
        for i, name in enumerate(self.features):
            v = features.get(name)
            v = self.fill[i] if v is None else v
            x.append((v - self.mean[i]) / (self.scale[i] or 1))
        outputs = {}
        for j, label in enumerate(self.labels):
            z = self.intercept[j] + sum(w * xi for w, xi in zip(self.coef[j], x))
            p = 1 / (1 + math.exp(-z))
            outputs[label] = LabelOutput(probability=round(p, 4), positive=p >= self.thresholds[j])
        return ClassificationResult(status="ok", model=self.name, outputs=outputs)


def load_classifier() -> ScreeningClassifier:
    try:
        if config.CLASSIFIER_FACTORY == "none":
            return UnconfiguredClassifier()
        if config.CLASSIFIER_FACTORY:
            module, _, attr = config.CLASSIFIER_FACTORY.partition(":")
            return getattr(importlib.import_module(module), attr)()
        if config.CLASSIFIER_MODEL_PATH:
            return JsonLogisticClassifier(config.CLASSIFIER_MODEL_PATH)
        from . import sklearn_model  # default: the bundled trained model
        return sklearn_model.load()
    except Exception:  # a broken model config must not take the screening down
        log.exception("could not load the screening classifier; running without a model")
    return UnconfiguredClassifier()


_classifier: ScreeningClassifier | None = None


def classify(features: dict, session=None) -> dict:
    global _classifier
    if _classifier is None:
        _classifier = load_classifier()
    try:
        result = _classifier.predict(features, session=session)
    except Exception as e:
        log.exception("classifier failed")
        result = ClassificationResult(status="error", message=str(e))
    return {**result.to_dict(), "feature_version": FEATURE_VERSION}
