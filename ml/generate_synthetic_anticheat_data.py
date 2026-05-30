import csv
import math
import random
from pathlib import Path


RANDOM_STATE = 42
ROW_COUNT = 10_000
MAX_PLAYERS = 4
MAX_MOVE_SPEED = 3.5
MOVE_SPEED_GRACE_MULTIPLIER = 1.35
MAX_HIT_DISTANCE = 60
MAX_ITEM_PICKUP_DISTANCE = 3

WEAPONS = {
    "Rifle": {"damage": 10, "fireRatePerSecond": 10, "maxAmmo": 30},
    "Shotgun": {"damage": 25, "fireRatePerSecond": 1.5, "maxAmmo": 8},
    "Pistol": {"damage": 12, "fireRatePerSecond": 5, "maxAmmo": 12},
    "BurstRifle": {"damage": 14, "fireRatePerSecond": 8, "maxAmmo": 24},
    "Sniper": {"damage": 50, "fireRatePerSecond": 0.8, "maxAmmo": 5},
    "HunterSniper": {"damage": 45, "fireRatePerSecond": 1, "maxAmmo": 6},
    "Launcher": {"damage": 60, "fireRatePerSecond": 0.5, "maxAmmo": 3},
    "MachineGun": {"damage": 8, "fireRatePerSecond": 14, "maxAmmo": 50},
    "Minigun": {"damage": 6, "fireRatePerSecond": 20, "maxAmmo": 80},
    "BlasterShotgun": {"damage": 30, "fireRatePerSecond": 1.2, "maxAmmo": 6},
    "RebelRifle": {"damage": 12, "fireRatePerSecond": 9, "maxAmmo": 25},
}

MODES = ["BATTLE", "PLAY_TO_AIRDROP"]


def clamp(value, low, high):
    return max(low, min(high, value))


def rand_int(low, high):
    return random.randint(low, high)


def choose_profile():
    roll = random.random()
    if roll < 0.86:
        return "normal"
    if roll < 0.94:
        return "high_skill"
    if roll < 0.985:
        return "suspicious_soft"
    return "suspicious_hard"


def poisson_like(mean):
    # Lightweight approximation good enough for deterministic synthetic fixtures.
    value = int(random.expovariate(1 / max(mean, 0.1)))
    return max(0, value)


def build_row(index):
    profile = choose_profile()
    mode = random.choices(MODES, weights=[0.82, 0.18], k=1)[0]
    weapon = random.choices(
        list(WEAPONS.keys()),
        weights=[16, 12, 13, 10, 6, 5, 4, 8, 5, 6, 9],
        k=1,
    )[0]
    weapon_config = WEAPONS[weapon]

    duration_seconds = rand_int(95, 420)
    survived_ratio = {
        "normal": random.betavariate(2.0, 1.6),
        "high_skill": random.betavariate(2.7, 1.1),
        "suspicious_soft": random.betavariate(3.0, 0.9),
        "suspicious_hard": random.betavariate(3.5, 0.75),
    }[profile]
    survived_seconds = int(clamp(duration_seconds * survived_ratio, 12, duration_seconds))

    if profile == "normal":
        kills = clamp(poisson_like(1.1), 0, 4)
        hit_rate = clamp(random.gauss(0.28, 0.11), 0.04, 0.62)
        movement_per_minute = clamp(random.gauss(115, 38), 22, 230)
        move_clamp_count = random.choices([0, 1, 2], weights=[91, 8, 1], k=1)[0]
        invalid_hit_count = random.choices([0, 1, 2], weights=[93, 6, 1], k=1)[0]
        fire_rate_reject_count = random.choices([0, 1, 2], weights=[94, 5, 1], k=1)[0]
        pickup_reject_count = random.choices([0, 1], weights=[95, 5], k=1)[0]
    elif profile == "high_skill":
        kills = rand_int(2, 6)
        hit_rate = clamp(random.gauss(0.47, 0.09), 0.22, 0.74)
        movement_per_minute = clamp(random.gauss(135, 42), 40, 260)
        move_clamp_count = random.choices([0, 1, 2, 3], weights=[83, 12, 4, 1], k=1)[0]
        invalid_hit_count = random.choices([0, 1, 2, 3], weights=[82, 12, 5, 1], k=1)[0]
        fire_rate_reject_count = random.choices([0, 1, 2, 3], weights=[84, 11, 4, 1], k=1)[0]
        pickup_reject_count = random.choices([0, 1, 2], weights=[91, 8, 1], k=1)[0]
    elif profile == "suspicious_soft":
        kills = rand_int(4, 10)
        hit_rate = clamp(random.gauss(0.68, 0.1), 0.43, 0.92)
        movement_per_minute = clamp(random.gauss(80, 50), 8, 260)
        move_clamp_count = rand_int(2, 9)
        invalid_hit_count = rand_int(2, 10)
        fire_rate_reject_count = rand_int(1, 8)
        pickup_reject_count = rand_int(0, 4)
    else:
        kills = rand_int(8, 18)
        hit_rate = clamp(random.gauss(0.86, 0.07), 0.62, 0.99)
        movement_per_minute = clamp(random.choice([random.gauss(35, 24), random.gauss(260, 75)]), 2, 480)
        move_clamp_count = rand_int(8, 28)
        invalid_hit_count = rand_int(8, 32)
        fire_rate_reject_count = rand_int(5, 24)
        pickup_reject_count = rand_int(1, 9)

    shots_accepted = max(kills + 1, int(kills / max(hit_rate, 0.05)) + rand_int(1, 18))
    hits_accepted = int(round(shots_accepted * hit_rate))
    if profile in ("suspicious_soft", "suspicious_hard"):
        hits_accepted = max(hits_accepted, kills + rand_int(2, 10))
    hits_accepted = min(hits_accepted, shots_accepted)

    damage_dealt = int(hits_accepted * weapon_config["damage"] * random.uniform(0.88, 1.16))
    damage_dealt = max(damage_dealt, kills * 35)
    damage_taken = int(clamp(random.gauss(75, 44), 0, 230))
    if profile == "suspicious_hard":
        damage_taken = int(clamp(random.gauss(34, 30), 0, 140))

    total_distance = int(movement_per_minute * survived_seconds / 60)
    max_move_speed_observed = clamp(
        random.gauss(3.0, 0.7) + move_clamp_count * random.uniform(0.08, 0.28),
        0,
        12 if profile.startswith("suspicious") else 6,
    )
    if profile == "suspicious_hard" and random.random() < 0.62:
        max_move_speed_observed = random.uniform(5.2, 12.0)

    placement = rand_int(1, MAX_PLAYERS)
    if kills >= 6 or survived_ratio > 0.83:
        placement = random.choices([1, 2, 3, 4], weights=[48, 27, 15, 10], k=1)[0]
    deaths = 0 if placement == 1 else 1
    is_winner = 1 if placement == 1 else 0

    pickup_count = rand_int(1, 10)
    melee_attack_count = rand_int(0, 8)
    melee_invalid_count = random.choices([0, 1, 2, 3], weights=[88, 8, 3, 1], k=1)[0]
    if profile.startswith("suspicious"):
        melee_invalid_count += rand_int(0, 5)

    vec_collected = 0
    vec_dropped = 0
    if mode == "PLAY_TO_AIRDROP":
        vec_collected = rand_int(0, 7)
        vec_dropped = rand_int(0, vec_collected)

    match_minutes = max(duration_seconds / 60, 1e-6)
    survived_minutes = max(survived_seconds / 60, 1e-6)
    actions_rejected = move_clamp_count + invalid_hit_count + fire_rate_reject_count + pickup_reject_count + melee_invalid_count
    total_actions = max(1, shots_accepted + pickup_count + melee_attack_count + actions_rejected)
    # Mirror AntiCheatTracker: moveClampRate = moveClampCount / max(moveEventCount, 1).
    move_event_count = max(move_clamp_count, int(survived_seconds * random.uniform(3.0, 8.0)))
    move_clamp_rate = move_clamp_count / max(1, move_event_count)
    damage_per_minute = damage_dealt / survived_minutes
    kills_per_minute = kills / survived_minutes
    damage_per_kill = damage_dealt / max(kills, 1)
    invalid_action_rate = actions_rejected / total_actions

    score = 0.0
    score += min(0.22, max(0, hit_rate - 0.55) * 0.5)
    score += min(0.18, max(0, damage_per_minute - 120) / 600)
    score += min(0.16, max(0, kills_per_minute - 0.9) / 4)
    score += min(0.16, invalid_action_rate * 0.9)
    score += min(0.14, move_clamp_count / 35)
    score += min(0.14, invalid_hit_count / 38)
    score = clamp(score + random.uniform(-0.035, 0.035), 0, 1)

    pseudo_label = 1 if score >= 0.5 or profile.startswith("suspicious") else 0
    label_name = "Suspicious" if pseudo_label else "Normal"

    reasons = []
    if hit_rate >= 0.7:
        reasons.append("HIGH_HIT_RATE")
    if damage_per_minute >= 145:
        reasons.append("HIGH_DAMAGE_PER_MINUTE")
    if kills_per_minute >= 1.2:
        reasons.append("HIGH_KILLS_PER_MINUTE")
    if move_clamp_count >= 5 or max_move_speed_observed > MAX_MOVE_SPEED * MOVE_SPEED_GRACE_MULTIPLIER:
        reasons.append("MOVEMENT_ANOMALY")
    if invalid_hit_count >= 5:
        reasons.append("INVALID_HIT_DISTANCE")
    if fire_rate_reject_count >= 5:
        reasons.append("FIRE_RATE_VIOLATION")
    if not reasons:
        reasons.append("BASELINE")

    return {
        "synthetic_id": f"syn_{index:05d}",
        "match_id": f"match_{index // MAX_PLAYERS:05d}",
        "participant_id": f"participant_{index:05d}",
        "user_id": f"user_{index % 2500:04d}",
        "mode": mode,
        "maxPlayers": MAX_PLAYERS,
        "matchDurationSeconds": duration_seconds,
        "survivedSeconds": survived_seconds,
        "placement": placement,
        "isWinner": is_winner,
        "primaryWeapon": weapon,
        "weaponDamage": weapon_config["damage"],
        "weaponFireRatePerSecond": weapon_config["fireRatePerSecond"],
        "kills": kills,
        "deaths": deaths,
        "damageDealt": damage_dealt,
        "damageTaken": damage_taken,
        "shotsAccepted": shots_accepted,
        "hitsAccepted": hits_accepted,
        "hitRate": round(hit_rate, 5),
        "invalidHitCount": invalid_hit_count,
        "fireRateRejectCount": fire_rate_reject_count,
        "totalDistance": total_distance,
        "movementPerMinute": round(movement_per_minute, 5),
        "maxMoveSpeedObserved": round(max_move_speed_observed, 5),
        "moveClampCount": move_clamp_count,
        "moveClampRate": round(move_clamp_rate, 5),
        "pickupCount": pickup_count,
        "pickupRejectCount": pickup_reject_count,
        "vecCollected": vec_collected,
        "vecDropped": vec_dropped,
        "meleeAttackCount": melee_attack_count,
        "meleeInvalidCount": melee_invalid_count,
        "actionsRejected": actions_rejected,
        "invalidActionRate": round(invalid_action_rate, 5),
        "killsPerMinute": round(kills_per_minute, 5),
        "damagePerMinute": round(damage_per_minute, 5),
        "damagePerKill": round(damage_per_kill, 5),
        "allowedMaxHitDistance": MAX_HIT_DISTANCE,
        "allowedMaxItemPickupDistance": MAX_ITEM_PICKUP_DISTANCE,
        "allowedMoveSpeedWithGrace": round(MAX_MOVE_SPEED * MOVE_SPEED_GRACE_MULTIPLIER, 5),
        "behaviorProfile": profile,
        "pseudoSuspiciousLabel": pseudo_label,
        "pseudoLabelName": label_name,
        "suspiciousScoreSeed": round(score, 5),
        "reasonCodes": "|".join(reasons),
    }


def main():
    random.seed(RANDOM_STATE)
    output_dir = Path(__file__).resolve().parent / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "vectoarena_anticheat_synthetic_10k.csv"

    rows = [build_row(index) for index in range(ROW_COUNT)]
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    suspicious_count = sum(row["pseudoSuspiciousLabel"] for row in rows)
    print(f"Wrote {len(rows)} rows to {output_path}")
    print(f"Pseudo suspicious rows: {suspicious_count} ({suspicious_count / len(rows):.2%})")


if __name__ == "__main__":
    main()
