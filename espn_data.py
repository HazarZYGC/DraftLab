"""Fetch and normalize three completed NBA seasons from ESPN's public web data."""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode


ESPN_URL = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
SEASON_WEIGHTS = (0.50, 0.30, 0.20)
STAT_NAMES = {
    "avgPoints": "pts", "avgRebounds": "reb", "avgAssists": "ast",
    "avgSteals": "stl", "avgBlocks": "blk", "avgTurnovers": "tov",
    "avgThreePointFieldGoalsMade": "three_pm", "fieldGoalPct": "fg_pct",
    "freeThrowPct": "ft_pct", "avgFieldGoalsAttempted": "fga",
    "avgFreeThrowsAttempted": "fta",
}


def completed_seasons(now: datetime | None = None) -> list[int]:
    now = now or datetime.now()
    latest = now.year if now.month >= 7 else now.year - 1
    return [latest, latest - 1, latest - 2]


def yahoo_positions(abbreviation: str) -> list[str]:
    value = (abbreviation or "").upper().replace(" ", "")
    if value in {"PG", "SG", "SF", "PF", "C"}:
        return [value]
    positions = []
    if "G" in value:
        positions.extend(["PG", "SG"])
    if "F" in value:
        positions.extend(["SF", "PF"])
    if "C" in value:
        positions.append("C")
    return positions or ["UTIL"]


def parse_season(payload: dict, season: int) -> list[dict]:
    definitions = {category["name"]: category.get("names", []) for category in payload.get("categories", [])}
    players = []
    for entry in payload.get("athletes", []):
        athlete = entry.get("athlete", {})
        values: dict[str, float] = {}
        for category in entry.get("categories", []):
            names = definitions.get(category.get("name"), [])
            raw_values = category.get("values", [])
            for index, name in enumerate(names):
                if index < len(raw_values):
                    values[name] = raw_values[index]
        games = int(values.get("gamesPlayed", 0) or 0)
        stats = {target: round(float(values.get(source, 0) or 0), 3) for source, target in STAT_NAMES.items()}
        for percentage in ("fg_pct", "ft_pct"):
            if stats.get(percentage, 0) > 1:
                stats[percentage] /= 100
        position = athlete.get("position", {}).get("abbreviation", "")
        status = athlete.get("status", {}).get("name", "Active")
        players.append({
            "id": str(athlete.get("id", "")), "name": athlete.get("displayName", "Unknown Player"),
            "team": athlete.get("teamShortName", "FA"), "positions": yahoo_positions(position),
            "source_position": position or "UTIL", "status": status, "injury_note": "",
            "headshot": athlete.get("headshot", {}).get("href", ""), "games": games,
            "stats": stats, "season": str(season),
        })
    return [player for player in players if player["id"]]


def blend_three_seasons(season_data: list[tuple[int, list[dict]]]) -> list[dict]:
    if not season_data:
        return []
    buckets: dict[str, list[tuple[int, dict, float]]] = {}
    for index, (season, players) in enumerate(season_data[:3]):
        for player in players:
            buckets.setdefault(player["id"], []).append((season, player, SEASON_WEIGHTS[index]))

    latest_season = season_data[0][0]
    result = []
    for entries in buckets.values():
        latest_entries = [entry for entry in entries if entry[0] == latest_season]
        if not latest_entries or latest_entries[0][1].get("games", 0) < 5:
            continue
        total_weight = sum(weight for _, _, weight in entries)
        latest = latest_entries[0][1]
        stat_keys = set().union(*(player.get("stats", {}).keys() for _, player, _ in entries))
        stats = {
            key: round(sum(float(player.get("stats", {}).get(key, 0) or 0) * weight for _, player, weight in entries) / total_weight, 3)
            for key in stat_keys
        }
        weighted_games = sum(min(82, player.get("games", 0)) * weight for _, player, weight in entries) / total_weight
        availability = min(1.0, weighted_games / 82)
        history_confidence = {1: 0.72, 2: 0.90, 3: 1.0}.get(len(entries), 1.0)
        result.append({
            **latest, "stats": stats, "games": round(weighted_games),
            "availability": round(availability, 3), "missed_game_rate": round(1 - availability, 3),
            "history_seasons": len(entries), "history_confidence": history_confidence,
            "season_history": [
                {"season": str(season), "games": player.get("games", 0), "stats": player.get("stats", {})}
                for season, player, _ in entries
            ],
        })
    return result


def load_players(data_dir: Path, fetch_json, force: bool = False) -> tuple[list[dict], list[str]]:
    data_dir.mkdir(exist_ok=True)
    seasons = completed_seasons()
    parsed = []
    for season in seasons:
        cache_file = data_dir / f"espn_nba_{season}.json"
        fresh = cache_file.exists() and time.time() - cache_file.stat().st_mtime < 7 * 24 * 3600
        if fresh and not force:
            payload = json.loads(cache_file.read_text())
        else:
            query = urlencode({
                "region": "us", "lang": "en", "contentorigin": "espn", "isqualified": "true",
                "page": 1, "limit": 700, "sort": "offensive.avgPoints:desc",
                "season": season, "seasontype": 2,
            })
            payload = fetch_json(f"{ESPN_URL}?{query}")
            cache_file.write_text(json.dumps(payload))
        parsed.append((season, parse_season(payload, season)))
    return blend_three_seasons(parsed), [str(season) for season in seasons]
