from pathlib import Path

import joblib
import numpy as np
import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
DATA_PATH = BASE_DIR / "outputs" / "vectoarena_pseudo_labeled.csv"
MODELS_DIR = BASE_DIR / "models"


REAL_MATCH = {
    "username": "Dat",
    "roomCode": "mEB5GCZ2F",
    "mode": "BATTLE",
    "matchDurationSeconds": 57,
    "survivedSeconds": 57,
    "placement": 1,
    "isWinner": 1,
    "primaryWeapon": "Shotgun",
    "weaponDamage": 25,
    "weaponFireRatePerSecond": 1.5,
    "kills": 2,
    "deaths": 0,
    "damageDealt": 60,
    "damageTaken": 0,
    "shotsAccepted": 8,
    "hitsAccepted": 5,
    "hitRate": 0.625,
    "invalidHitCount": 0,
    "fireRateRejectCount": 0,
    "totalDistance": 146.132,
    "movementPerMinute": 153.82361699117664,
    "maxMoveSpeedObserved": 14.000036681039502,
    "moveClampCount": 0,
    "moveClampRate": 0,
    "pickupCount": 1,
    "pickupRejectCount": 0,
    "meleeAttackCount": 1,
    "meleeInvalidCount": 0,
    "actionsRejected": 0,
    "invalidActionRate": 0,
    "killsPerMinute": 2.1052631578947367,
    "damagePerMinute": 63.15789473684211,
    "damagePerKill": 30,
}


def percentile(series: pd.Series, value: float) -> float:
    clean = series.dropna().to_numpy()
    return float((clean <= value).mean() * 100)


def build_model_row(feature_cols: list[str]) -> pd.DataFrame:
    row = {col: 0.0 for col in feature_cols}
    for key, value in REAL_MATCH.items():
        if key in row:
            row[key] = value

    mode_col = f"mode_{REAL_MATCH['mode']}"
    weapon_col = f"primaryWeapon_{REAL_MATCH['primaryWeapon']}"
    if mode_col in row:
        row[mode_col] = 1.0
    if weapon_col in row:
        row[weapon_col] = 1.0
    return pd.DataFrame([row], columns=feature_cols)


def main() -> None:
    df = pd.read_csv(DATA_PATH)
    feature_cols = joblib.load(MODELS_DIR / "vectoarena_feature_cols.pkl")
    scaler = joblib.load(MODELS_DIR / "vectoarena_scaler.pkl")
    random_forest = joblib.load(MODELS_DIR / "vectoarena_random_forest.pkl")
    decision_tree = joblib.load(MODELS_DIR / "vectoarena_decision_tree.pkl")
    kmeans = joblib.load(MODELS_DIR / "vectoarena_kmeans.pkl")
    gmm = joblib.load(MODELS_DIR / "vectoarena_gmm.pkl")

    X_real = build_model_row(feature_cols)
    rf_proba = random_forest.predict_proba(X_real)[0]
    dt_proba = decision_tree.predict_proba(X_real)[0]
    rf_pred = int(random_forest.predict(X_real)[0])
    dt_pred = int(decision_tree.predict(X_real)[0])

    X_train = df[feature_cols]
    X_scaled = scaler.transform(X_train)
    x_scaled = scaler.transform(X_real)
    distances = np.linalg.norm(X_scaled - x_scaled, axis=1)
    nearest = df.assign(distance=distances).nsmallest(8, "distance")

    kmeans_cluster = int(kmeans.predict(x_scaled)[0])
    kmeans_stats = df.groupby("kmeans_cluster")["suspicious_label"].agg(["count", "mean"]).reset_index()

    gmm_logprob = float(gmm.score_samples(x_scaled)[0])
    gmm_threshold_5pct = float(np.percentile(gmm.score_samples(X_scaled), 5))

    selected_cols = [
        "kills",
        "damageDealt",
        "shotsAccepted",
        "hitsAccepted",
        "hitRate",
        "invalidHitCount",
        "fireRateRejectCount",
        "movementPerMinute",
        "maxMoveSpeedObserved",
        "moveClampCount",
        "invalidActionRate",
        "killsPerMinute",
        "damagePerMinute",
        "damagePerKill",
    ]

    normal = df[df["suspicious_label"] == 0]
    suspicious = df[df["suspicious_label"] == 1]
    rows = []
    for col in selected_cols:
        value = float(REAL_MATCH[col])
        rows.append(
            {
                "feature": col,
                "real": round(value, 4),
                "pct_all": round(percentile(df[col], value), 1),
                "normal_mean": round(float(normal[col].mean()), 4),
                "normal_p95": round(float(normal[col].quantile(0.95)), 4),
                "suspicious_mean": round(float(suspicious[col].mean()), 4),
            }
        )

    print("REAL_MATCH")
    print(
        pd.Series(
            {
                "username": REAL_MATCH["username"],
                "roomCode": REAL_MATCH["roomCode"],
                "result": "win",
                "survivedSeconds": REAL_MATCH["survivedSeconds"],
                "primaryWeapon": REAL_MATCH["primaryWeapon"],
                "kills": REAL_MATCH["kills"],
                "damageDealt": REAL_MATCH["damageDealt"],
                "hitRate": REAL_MATCH["hitRate"],
                "invalidHitCount": REAL_MATCH["invalidHitCount"],
                "fireRateRejectCount": REAL_MATCH["fireRateRejectCount"],
                "moveClampCount": REAL_MATCH["moveClampCount"],
                "invalidActionRate": REAL_MATCH["invalidActionRate"],
            }
        ).to_string()
    )
    print("\nMODEL_SCORE")
    print(
        pd.DataFrame(
            [
                {
                    "model": "Random Forest",
                    "prediction": "Suspicious" if rf_pred else "Normal",
                    "suspicious_probability": round(float(rf_proba[1]), 6),
                },
                {
                    "model": "Decision Tree",
                    "prediction": "Suspicious" if dt_pred else "Normal",
                    "suspicious_probability": round(float(dt_proba[1]), 6),
                },
                {
                    "model": "KMeans",
                    "prediction": f"cluster {kmeans_cluster}",
                    "suspicious_probability": round(
                        float(kmeans_stats.loc[kmeans_stats["kmeans_cluster"] == kmeans_cluster, "mean"].iloc[0]),
                        6,
                    ),
                },
                {
                    "model": "GMM",
                    "prediction": "Suspicious" if gmm_logprob <= gmm_threshold_5pct else "Normal",
                    "suspicious_probability": np.nan,
                },
            ]
        ).to_string(index=False)
    )
    print(f"GMM log probability: {gmm_logprob:.4f}; 5pct threshold: {gmm_threshold_5pct:.4f}")

    print("\nFEATURE_COMPARISON")
    print(pd.DataFrame(rows).to_string(index=False))

    print("\nNEAREST_SYNTHETIC_ROWS")
    cols = [
        "distance",
        "pseudoLabelName",
        "behaviorProfile",
        "kills",
        "damageDealt",
        "hitRate",
        "invalidHitCount",
        "moveClampCount",
        "invalidActionRate",
        "killsPerMinute",
        "damagePerMinute",
    ]
    if "primaryWeapon" in nearest.columns:
        cols.append("primaryWeapon")
    print(nearest[cols].to_string(index=False))


if __name__ == "__main__":
    main()
