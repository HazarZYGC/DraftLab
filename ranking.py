"""Small, transparent ranking engine for NBA fantasy basketball."""

from __future__ import annotations

from math import sqrt


CATEGORIES = ("fg_pct", "ft_pct", "three_pm", "pts", "reb", "ast", "stl", "blk", "tov")
NEGATIVE_CATEGORIES = {"tov"}
POINT_WEIGHTS = {
    "pts": 1.0,
    "reb": 1.2,
    "ast": 1.5,
    "stl": 3.0,
    "blk": 3.0,
    "tov": -1.0,
}


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 1.0
    avg = _mean(values)
    variance = sum((value - avg) ** 2 for value in values) / len(values)
    return sqrt(variance) or 1.0


def rank_players(
    players: list[dict], mode: str = "points", excluded: set[str] | None = None,
    point_weights: dict[str, float] | None = None,
) -> list[dict]:
    """Return a new list ordered by fantasy value.

    Category mode uses population z-scores. Turnovers are inverted; percentages are
    volume-adjusted so low-volume specialists do not dominate the list.
    """
    excluded = excluded or set()
    point_weights = point_weights or POINT_WEIGHTS
    healthy_pool = [p for p in players if p.get("games", 0) >= 3] or players
    moments: dict[str, tuple[float, float]] = {}

    for category in CATEGORIES:
        values = [float(player.get("stats", {}).get(category, 0) or 0) for player in healthy_pool]
        moments[category] = (_mean(values), _std(values))

    ranked: list[dict] = []
    for player in players:
        item = {**player, "stats": dict(player.get("stats", {}))}
        stats = item["stats"]
        category_scores: dict[str, float] = {}

        if mode == "points":
            per_game_score = sum(float(stats.get(key, 0) or 0) * weight for key, weight in point_weights.items())
            category_scores = {key: float(stats.get(key, 0) or 0) * weight for key, weight in point_weights.items()}
            availability = min(1.0, max(0.0, float(item.get("availability", 1))))
            missed_rate = 1 - availability
            # No IL slots: missed games are deliberately punished twice—first
            # through projected games, then through a recurrence-risk haircut.
            expected_games = 82 * (0.20 + 0.80 * availability)
            availability_multiplier = max(0.55, 1 - (0.60 * missed_rate))
            history_confidence = min(1.0, max(0.5, float(item.get("history_confidence", 1))))
            projected_total = per_game_score * expected_games * availability_multiplier * history_confidence
            raw_score = projected_total
            item["fantasy_ppg"] = round(per_game_score, 2)
            item["availability_multiplier"] = round(availability_multiplier, 3)
            item["expected_games"] = round(expected_games)
            item["projected_total"] = round(projected_total, 1)
            item["history_confidence"] = history_confidence
        else:
            raw_score = 0.0
            for category in CATEGORIES:
                if category in excluded:
                    continue
                avg, std = moments[category]
                value = float(stats.get(category, 0) or 0)
                z_score = (value - avg) / std
                if category in NEGATIVE_CATEGORIES:
                    z_score *= -1
                if category in {"fg_pct", "ft_pct"}:
                    attempts = float(stats.get("fga" if category == "fg_pct" else "fta", 1) or 1)
                    z_score *= min(1.35, max(0.35, attempts / 8))
                category_scores[category] = z_score
                raw_score += z_score

        status = str(item.get("status", "Healthy")).lower()
        risk_penalty = 0.0
        if any(word in status for word in ("out", "inj", "suspended")):
            risk_penalty = raw_score * 0.15 if mode == "points" else 1.6
        elif any(word in status for word in ("day-to-day", "questionable", "gtd")):
            risk_penalty = raw_score * 0.07 if mode == "points" else 0.55

        item["base_score"] = round(raw_score, 3)
        item["score"] = round(raw_score - risk_penalty, 3)
        item["category_scores"] = {key: round(value, 2) for key, value in category_scores.items()}
        item["risk_penalty"] = risk_penalty
        ranked.append(item)

    ranked.sort(key=lambda player: player["score"], reverse=True)
    for index, player in enumerate(ranked, start=1):
        player["rank"] = index
    return ranked


def recommendation_score(player: dict, roster: list[dict], round_number: int) -> tuple[float, list[str]]:
    """Add small, explainable roster-fit bonuses to the global player value."""
    score = float(player.get("score", 0))
    reasons: list[str] = []
    positions = set(player.get("positions", []))
    roster_positions = [position for member in roster for position in member.get("positions", [])]

    thin_positions = [position for position in positions if roster_positions.count(position) == 0]
    if thin_positions and round_number >= 3:
        score += 0.35
        reasons.append(f"Kadroda {thin_positions[0]} eksiğini kapatıyor")

    if len(positions) >= 2:
        score += 0.15
        reasons.append("Çoklu mevki esnekliği")

    if player.get("risk_penalty", 0) == 0:
        score += 0.12
        reasons.append("Aktif / düşük sakatlık riski")
    else:
        reasons.append("Sakatlık riski değeri aşağı çekiyor")

    if not reasons:
        reasons.append("Kalan oyuncular içinde en yüksek toplam kategori değeri")
    return round(score, 3), reasons
