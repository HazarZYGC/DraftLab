# DraftLab — NBA Salary Cap Draft Assistant

DraftLab is a lightweight NBA fantasy basketball ranking and live auction companion. It is designed for a Yahoo Head-to-Head Points League with a salary-cap draft, but it does not require Yahoo API access to load player statistics.

## What It Does

- Retrieves the three most recently completed NBA seasons from ESPN's public web data endpoint
- Uses a 50% / 30% / 20% recency blend
- Applies a deliberately strong missed-game penalty for leagues without IL slots
- Converts ESPN's positional groups into Yahoo-style eligibility groups
- Produces dynamic auction values based on league size, budget, roster size, position scarcity, and the remaining player pool
- Simulates Yahoo's circular salary-cap nomination order
- Uses configurable nomination and bid timers
- Resets the bid clock to 10 seconds when a late bid is entered
- Lets the user manually enter every manager's real draft bid
- Tracks budgets, roster space, purchases, market inflation, and the user's targets
- Recalculates a recommended maximum bid after every purchase
- Stores the active auction locally across page refreshes

## Run Locally

```bash
cd FantasyLeague
python3 server.py
```

Open `https://localhost:8000`. The local development certificate is self-signed, so a browser may display a certificate warning on first use.

No third-party Python packages are required.

## Data Source

DraftLab currently uses ESPN's public, unauthenticated web statistics endpoint. This is not a formally supported developer API, so completed-season responses are cached locally for seven days and the application falls back to demo data if the endpoint becomes unavailable.

As of October 2026, the model uses the completed 2025-26, 2024-25, and 2023-24 seasons, identified by ESPN as seasons `2026`, `2025`, and `2024`.

Yahoo OAuth support remains in the codebase for future league metadata and exact player eligibility. Player rankings and the auction simulator do not depend on Yahoo approval.

## Points Formula

```text
Fantasy points per game =
PTS + 1.2 × REB + 1.5 × AST + 3 × STL + 3 × BLK − TO
```

Three-pointers do not receive an additional bonus.

## Three-Season Projection

Players are matched between seasons using their ESPN athlete ID:

- Most recently completed season: 50%
- Previous season: 30%
- Third season: 20%

Players with fewer than five games in the latest completed season are excluded from the primary draft pool. Players with only one season of NBA evidence receive a 0.72 confidence multiplier; players with two seasons receive 0.90. This keeps rookies and other small-history players from being priced like equally productive veterans until a dedicated projection source is added.

## Availability and Injury Risk

Because the league has no IL slots, historical availability receives a large penalty:

```text
Weighted GP = latest GP × 0.50 + previous GP × 0.30 + third GP × 0.20
Availability = weighted GP / 82
Projected games = 82 × (0.20 + 0.80 × availability)
Recurrence multiplier = max(0.55, 1 − 0.60 × missed-game rate)
Risk-adjusted season total = fantasy PPG × projected games × recurrence multiplier
```

This deliberately penalizes injury-prone players twice: fewer projected games and an additional recurrence-risk haircut. Missed games can also include rest, suspensions, or rotation decisions; a dedicated injury-history provider can later separate those cases.

## Auction Valuation

Auction values are recalculated for the configured number of teams, roster size, and budget:

1. A replacement baseline is estimated separately for PG, SG, SF, PF, and C.
2. Each player's risk-adjusted projected total is compared with the relevant positional baseline.
3. Multi-position eligibility receives a small flexibility bonus.
4. The league's discretionary budget—total money after reserving $1 for every roster spot—is distributed in proportion to value above replacement.
5. During the draft, recommended maximum bids adjust for the user's roster needs, remaining budget pace, marked targets, risk, and observed market inflation.

The model never recommends a bid above Yahoo's legal maximum: current budget minus $1 for every empty roster spot remaining after the purchase.

## Yahoo-Style Salary Cap Flow

Default settings mirror Yahoo's public salary-cap draft format:

- $200 starting budget
- 30-second nomination timer
- 20-second bid timer
- $1 minimum opening bid
- Any bid with fewer than 10 seconds remaining resets the timer to 10 seconds
- Nomination order rotates in a circle rather than snaking

All settings can be changed before starting the simulator. Opponent bids are entered manually so the simulator can run beside the real Yahoo draft.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

## Privacy

Credentials, OAuth tokens, local HTTPS certificates, cached API responses, and the active auction are not committed to Git. Yahoo access, when enabled, is read-only.
