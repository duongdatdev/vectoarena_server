import json
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np


warnings.filterwarnings("ignore", category=UserWarning)

MODEL_VERSION = "rf-synthetic-v1"
REVIEW_THRESHOLD = 0.5
SUSPICIOUS_THRESHOLD = 0.75
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"


def numeric(value):
    try:
        if value is None:
            return 0.0
        parsed = float(value)
        return parsed if np.isfinite(parsed) else 0.0
    except (TypeError, ValueError):
        return 0.0


def feature_value(column, snapshot):
    if column.startswith("mode_"):
        return 1.0 if snapshot.get("mode") == column.removeprefix("mode_") else 0.0
    if column.startswith("primaryWeapon_"):
        return 1.0 if snapshot.get("primaryWeapon") == column.removeprefix("primaryWeapon_") else 0.0
    return numeric(snapshot.get(column))


def label_for_score(score):
    if score >= SUSPICIOUS_THRESHOLD:
        return "Suspicious"
    if score >= REVIEW_THRESHOLD:
        return "Review"
    return "Normal"


def reason_codes(snapshot, score):
    reasons = []
    if numeric(snapshot.get("invalidHitCount")) > 0:
        reasons.append("high_invalid_hit")
    if numeric(snapshot.get("moveClampCount")) > 2:
        reasons.append("high_move_clamp")
    if numeric(snapshot.get("pickupRejectCount")) > 2:
        reasons.append("high_pickup_reject")
    if numeric(snapshot.get("fireRateRejectCount")) > 1:
        reasons.append("high_fire_rate_reject")
    if numeric(snapshot.get("damagePerMinute")) > 120:
        reasons.append("high_damage_per_minute")
    if numeric(snapshot.get("killsPerMinute")) > 1.9:
        reasons.append("high_kills_per_minute")
    if score >= REVIEW_THRESHOLD and not reasons:
        reasons.append("model_probability")
    return reasons


def main():
    snapshot = json.load(sys.stdin)
    feature_cols = joblib.load(MODELS_DIR / "vectoarena_feature_cols.pkl")
    scaler = joblib.load(MODELS_DIR / "vectoarena_scaler.pkl")
    model = joblib.load(MODELS_DIR / "vectoarena_random_forest.pkl")

    row = np.array([[feature_value(column, snapshot) for column in feature_cols]], dtype=float)
    scaled = scaler.transform(row)
    prediction = int(model.predict(scaled)[0])

    if hasattr(model, "predict_proba") and 1 in model.classes_:
        probabilities = model.predict_proba(scaled)[0]
        score = float(probabilities[list(model.classes_).index(1)])
    else:
        score = float(prediction)

    result = {
        "score": max(0.0, min(1.0, score)),
        "label": label_for_score(score),
        "modelVersion": MODEL_VERSION,
        "reasonCodes": reason_codes(snapshot, score),
    }
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
