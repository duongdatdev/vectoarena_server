# VectoArena Anti-Cheat Synthetic Data

This folder contains a synthetic 10k-row dataset for bootstrapping the VectoArena anti-cheat ML pipeline when real telemetry is not available yet.

Generated file:

- `data/vectoarena_anticheat_synthetic_10k.csv`

Generator:

- `generate_synthetic_anticheat_data.py`

Jupyter notebook-style training file:

- `notebooks/vectoarena_anticheat_training.ipynb`

## Why These Columns Fit VectoArena

The dataset is based on the current server implementation in `src/rooms/BattleRoom.ts`, `config/gameplay/default.json`, and `prisma/schema.prisma`.

Server-backed match fields:

- `mode`, `maxPlayers`, `matchDurationSeconds`
- `survivedSeconds`, `placement`, `isWinner`
- `kills`, `deaths`, `damageDealt`, `damageTaken`
- `vecCollected`, `vecDropped`

Only `survivedSeconds` and one-hot encoded `mode` are used as training features by default. Outcome-style fields such as `placement`, `isWinner`, `deaths`, and `damageTaken` are kept in the dataset for analysis but excluded from training to avoid teaching the model that winning or losing is suspicious.

Server-authoritative anti-cheat signals:

- `shotsAccepted`, `hitsAccepted`, `hitRate`
- `invalidHitCount`
- `fireRateRejectCount`
- `totalDistance`, `movementPerMinute`, `maxMoveSpeedObserved`
- `moveClampCount`, `moveClampRate`
- `pickupCount`, `pickupRejectCount`
- `meleeAttackCount`, `meleeInvalidCount`

`moveClampRate` mirrors the server tracker formula: `moveClampCount / max(moveEventCount, 1)`.

Derived ML features:

- `actionsRejected`
- `invalidActionRate`
- `killsPerMinute`
- `damagePerMinute`
- `damagePerKill`

`actionsRejected` is kept for reporting/debugging, but the default training set uses `invalidActionRate` plus the individual rejection counts instead. This avoids giving the model a shortcut that simply relearns the rule-based aggregate.

Reference config fields:

- `allowedMaxHitDistance`
- `allowedMaxItemPickupDistance`
- `allowedMoveSpeedWithGrace`

These config fields are kept in the dataset for reference. They are excluded from the default training set while they are effectively constant in synthetic data.

## Default Training Features

The notebook intentionally uses a curated feature set:

- `survivedSeconds`
- `weaponDamage`, `weaponFireRatePerSecond`
- `shotsAccepted`, `hitsAccepted`, `hitRate`
- `invalidHitCount`, `fireRateRejectCount`
- `movementPerMinute`, `maxMoveSpeedObserved`, `moveClampCount`, `moveClampRate`
- `pickupCount`, `pickupRejectCount`, `meleeAttackCount`, `meleeInvalidCount`
- `invalidActionRate`
- `killsPerMinute`, `damagePerMinute`, `damagePerKill`
- one-hot encoded `mode`
- one-hot encoded `primaryWeapon`

Excluded from default training:

- ID columns: `synthetic_id`, `match_id`, `participant_id`, `user_id`
- Synthetic labels/helpers: `behaviorProfile`, `pseudoSuspiciousLabel`, `pseudoLabelName`, `suspiciousScoreSeed`, `reasonCodes`
- Match outcome columns: `placement`, `isWinner`, `deaths`, `damageTaken`
- Raw performance totals replaced by rates: `kills`, `damageDealt`
- Synthetic/reference or mostly constant context: `maxPlayers`, `matchDurationSeconds`, `vecCollected`, `vecDropped`, `totalDistance`, `allowedMaxHitDistance`, `allowedMaxItemPickupDistance`, `allowedMoveSpeedWithGrace`
- Aggregate shortcut: `actionsRejected`

Synthetic-only helper labels:

- `behaviorProfile`
- `pseudoSuspiciousLabel`
- `pseudoLabelName`
- `suspiciousScoreSeed`
- `reasonCodes`

Use helper labels for pipeline testing and supervised baseline experiments only. When enough real data exists, retrain from real server telemetry and use unsupervised or review-confirmed labels instead.

## Regenerate

```bash
python VectoArena_Server/ml/generate_synthetic_anticheat_data.py
```

## Train With Jupyter

Install Python dependencies:

```bash
cd VectoArena_Server/ml
python -m pip install -r requirements-ml.txt
```

Open the notebook-style file in VS Code/Jupyter and run cells from top to bottom:

- `notebooks/vectoarena_anticheat_training.ipynb`

Outputs:

- `models/vectoarena_scaler.pkl`
- `models/vectoarena_feature_cols.pkl`
- `models/vectoarena_kmeans.pkl`
- `models/vectoarena_meanshift.pkl`
- `models/vectoarena_dbscan.pkl`
- `models/vectoarena_gmm.pkl`
- `models/vectoarena_decision_tree.pkl`
- `models/vectoarena_random_forest.pkl`
- `outputs/model_summary.csv`
- `outputs/figures/*.png`

The notebook uses K-Means, Mean Shift, DBSCAN, and GMM to create cluster votes, then trains Decision Tree and Random Forest from pseudo-labels. Synthetic labels are kept only for presentation/testing and are not used as clustering features.
