"""Normalize ESPN history and Yahoo's public salary-cap market data."""

from __future__ import annotations

import json
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode


ESPN_URL = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
YAHOO_DRAFT_PAGE = "https://basketball.fantasysports.yahoo.com/nba/draftanalysis?type=salcap"
YAHOO_PUBLIC_API = "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2"
SEASON_WEIGHTS = (0.50, 0.30, 0.20)
STAT_NAMES = {
    "avgPoints": "pts", "avgRebounds": "reb", "avgAssists": "ast",
    "avgSteals": "stl", "avgBlocks": "blk", "avgTurnovers": "tov",
    "avgThreePointFieldGoalsMade": "three_pm", "fieldGoalPct": "fg_pct",
    "freeThrowPct": "ft_pct", "avgFieldGoalsAttempted": "fga",
    "avgFreeThrowsAttempted": "fta",
}


def normalized_name(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value or "")
    plain = "".join(character for character in plain if not unicodedata.combining(character))
    parts = re.findall(r"[a-z0-9]+", plain.lower())
    while parts and parts[-1] in {"jr", "sr", "ii", "iii", "iv"}:
        parts.pop()
    return "".join(parts)


def numeric(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_yahoo_salary(payload: dict) -> list[dict]:
    players = payload.get("fantasy_content", {}).get("league", {}).get("players", [])
    result = []
    for entry in players if isinstance(players, list) else []:
        player = entry.get("player", {})
        name = player.get("name", {}).get("full", "")
        if not name:
            continue
        analysis = player.get("draft_analysis", {}) or {}
        positions = [
            item.get("position") for item in player.get("eligible_positions", [])
            if item.get("position") not in {"G", "F", "Util", "BN", "IL", "IL+"}
        ]
        result.append({
            "name": name,
            "name_key": normalized_name(name),
            "yahoo_id": str(player.get("player_id", "")),
            "yahoo_average_salary": numeric(analysis.get("average_cost") or player.get("average_auction_cost")),
            "yahoo_projected_salary": numeric(player.get("projected_auction_value")),
            "yahoo_percent_drafted": numeric(analysis.get("percent_drafted")),
            "yahoo_rank": next((int(numeric(rank.get("player_rank", {}).get("rank_value")))
                                for rank in player.get("player_ranks", []) if numeric(rank.get("player_rank", {}).get("rank_value"))), 0),
            "yahoo_positions": positions,
        })
    return result


def enrich_with_yahoo_salary(players: list[dict], salary_players: list[dict]) -> list[dict]:
    by_name = {player["name_key"]: player for player in salary_players}
    enriched = []
    for player in players:
        salary = by_name.get(normalized_name(player.get("name", "")), {})
        item = {**player, **{key: value for key, value in salary.items() if key != "name"}}
        if salary.get("yahoo_positions"):
            item["positions"] = salary["yahoo_positions"]
        enriched.append(item)
    return enriched


def load_yahoo_salary(data_dir: Path, fetch_json, fetch_text, force: bool = False) -> tuple[list[dict], str]:
    """Load the same public Avg $ data shown on Yahoo's salary-cap analysis page."""
    data_dir.mkdir(exist_ok=True)
    cache_file = data_dir / "yahoo_nba_salary.json"
    fresh = cache_file.exists() and time.time() - cache_file.stat().st_mtime < 6 * 3600
    if fresh and not force:
        cached = json.loads(cache_file.read_text())
        return cached.get("players", []), str(cached.get("game_id", ""))

    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/html"}
    page = fetch_text(YAHOO_DRAFT_PAGE, headers=headers)
    match = re.search(r'var\s+gameId\s*=\s*"(\d+)"', page)
    if not match:
        raise RuntimeError("Yahoo NBA game id bulunamadı")
    game_id = match.group(1)
    path = (
        f"league/{game_id}.l.public;out=settings/players;position=ALL;start=0;count=300;"
        "sort=average_cost;search=;out=auction_values,ranks;ranks=o-rank;out=expert_ranks;"
        "expert_ranks.rank_type=projected_season_remaining/draft_analysis;cut_types=diamond;"
        "slices=last7days?format=json_f"
    )
    payload = fetch_json(f"{YAHOO_PUBLIC_API}/{path}", headers=headers)
    players = parse_yahoo_salary(payload)
    cache_file.write_text(json.dumps({"game_id": game_id, "players": players}))
    return players, game_id


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
