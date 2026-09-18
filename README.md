# DraftLab — Yahoo NBA Fantasy Assistant

DraftLab is a lightweight, read-only NBA fantasy basketball tool. It ranks players for a Yahoo Head-to-Head Points League and provides recommendations during a live snake draft.

The application is intentionally simple and has no third-party Python dependencies.

## Features

- Yahoo OAuth 2.0 connection with automatic access-token refresh
- Two-season, risk-adjusted NBA player rankings
- Yahoo default Points League scoring
- Position filters and player search
- Current player status and injury-note support when supplied by Yahoo
- Snake-draft simulation with a randomized draft order
- Manual tracking of every selection made in the real draft
- Roster-aware recommendations for the user's next pick
- Local draft persistence across page refreshes
- Demo mode when Yahoo data is not connected

## Running Locally

```bash
cd FantasyLeague
python3 server.py
```

Open `https://localhost:8000` in a browser. The project uses a self-signed development certificate, so the browser may display a local certificate warning on first use.

The application works in demo mode without a Yahoo connection, allowing the ranking interface and complete draft flow to be tested.

## Connecting Yahoo Fantasy Sports

Yahoo Fantasy API access requires both a Yahoo Developer application and approval for read-only Fantasy Sports API access.

1. Create an application in the [Yahoo Developer Network](https://developer.yahoo.com/apps/).
2. Select **Fantasy Sports — Read**.
3. Use `https://localhost:8000/auth/yahoo/callback` as the redirect URI.
4. Apply for Fantasy Sports API access through the [Yahoo Sports Developer portal](https://sports.yahoo.com/developer/access/).
5. Copy `.env.example` to `.env` and add the Yahoo Client ID and Client Secret.
6. Restart the server and select **Connect Yahoo Account** in the application.

Example configuration:

```env
YAHOO_CLIENT_ID=
YAHOO_CLIENT_SECRET=
YAHOO_REDIRECT_URI=https://localhost:8000/auth/yahoo/callback
YAHOO_LEAGUE_KEY=
PORT=8000
```

Access tokens expire after approximately one hour. DraftLab stores the refresh token locally in `.data/yahoo_tokens.json` and refreshes the access token when necessary. The `.env`, `.data`, and `.cert` directories are excluded from Git and must never be committed.

## Points League Model

The default scoring formula follows the standard Yahoo points configuration provided for this league:

```text
Fantasy points per game =
PTS + 1.2 × REB + 1.5 × AST + 3 × STL + 3 × BLK − TO
```

Three-pointers do not receive an additional bonus.

Before the new NBA season begins, DraftLab combines the two most recently completed Yahoo seasons. Players are matched between seasons using Yahoo's stable `player_id`:

- Most recently completed season: 65%
- Previous completed season: 35%

### Availability and Injury Risk

Yahoo does not provide a complete historical injury-event archive through the Fantasy API. DraftLab therefore uses missed games as a transparent availability-risk proxy:

```text
Weighted games played = latest season GP × 0.65 + previous season GP × 0.35
Missed-game rate = 1 − weighted games played / 82
Availability multiplier = 1 − 0.35 × missed-game rate
```

For example, a player who missed 30% of games receives a 10.5% draft-value discount. A current `OUT` or `INJ` designation applies an additional 10% discount, while `DTD`, `GTD`, or `Questionable` applies an additional 4% discount.

Missed games can include rest, suspensions, rotation decisions, or other absences in addition to injuries. A dedicated historical injury source may be added later to distinguish these cases.

Rookies and players without historical NBA data are treated conservatively until a separate projection source is available.

## Draft Recommendations

After the league size and number of rounds are entered, DraftLab randomly places the user in a snake-draft order. During the real draft, selecting a player card assigns that player to the current team, removes the player from the available pool, advances the draft, and recalculates the recommendation.

The recommendation starts with the player's risk-adjusted Points League value and adds small, explainable roster-fit adjustments:

- `+0.35` when the player fills a missing position after round three
- `+0.15` for multi-position eligibility
- `+0.12` for an active, low-risk player

Draft state is stored only in the browser's local storage.

## Optional 9-Category Model

The interface also retains a comparison-only 9-category model using FG%, FT%, 3PM, PTS, REB, AST, STL, BLK, and TO. It uses population z-scores, reverses turnovers, and volume-adjusts percentage categories. The primary and default model remains Points League.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

Demo statistics exist only to exercise the interface and are not presented as live data. Once an approved Yahoo account is connected, DraftLab retrieves the two most recently completed NBA seasons when the page is opened or manually refreshed.

## Privacy and Data Use

DraftLab requests read-only Yahoo Fantasy Sports access. It does not modify leagues, submit transactions, resell Yahoo data, or share user information. Credentials and OAuth tokens remain on the user's local machine.
