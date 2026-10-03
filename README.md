# DraftLab — NBA Salary Cap Draft Assistant

DraftLab is a lightweight NBA fantasy basketball ranking and live auction companion. It is designed for a Yahoo Head-to-Head Points League with a salary-cap draft, but it does not require Yahoo API access to load player statistics.

## What It Does

- Retrieves the three most recently completed NBA seasons from ESPN's public web data endpoint
- Imports the current Yahoo Salary Cap `Avg $` and projected price from Yahoo's public draft-analysis feed without OAuth
- Uses a 55% / 30% / 15% recency blend
- Applies a deliberately strong missed-game penalty for leagues without IL slots
- Converts ESPN's positional groups into Yahoo-style eligibility groups
- Produces dynamic auction values based on league size, budget, roster size, position scarcity, and the remaining player pool
- Simulates Yahoo's circular salary-cap nomination order
- Lets the user select the nominated player and see one clear maximum bid without recording every intermediate offer
- Records only the winning team and final sale price when a nomination ends
- Provides configurable nomination and bid countdowns without auto-awarding a player
- Tracks budgets, roster space, purchases, market inflation, and the user's targets
- Builds a living 13-player Yahoo roster plan and orders its remaining targets from expensive to cheap
- Uses nearly all remaining salary-cap money in the plan while retaining a small safety reserve
- Optionally asks an OpenAI model to re-rank the numeric shortlist and move maximum bids by at most $20 in either direction
- Reserves larger envelopes for one or two durable elite stars, then fills the roster with disciplined value picks
- Lets the AI adviser research a small set of projection-only rookies or returning players when current context is needed
- Replaces a planned player automatically when another team buys him, then recalculates the budget and positional fit
- Compares every nominated player with the closest same-position player in the current plan
- Keeps a primary target and reserves enough budget for that player while evaluating other nominations
- Recalculates maximum bids after every purchase using all teams' remaining budgets
- Stores the active auction locally across page refreshes

## Run Locally

```bash
cd FantasyLeague
python3 server.py
```

Open `https://localhost:8000`. The local development certificate is self-signed, so a browser may display a certificate warning on first use.

No third-party Python packages are required.

### Optional AI Adviser

Add an OpenAI API key to the existing local `.env` file:

```text
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-6-astra
```

Restart `server.py`, then use **AI ile planı iyileştir** in the living roster plan. The API key remains on the server and is never sent to the browser. `OPENAI_MODEL` is optional.

The AI layer receives a limited shortlist with each player's actual H2H points-per-game and total-points history under the configured scoring formula, weighted projections, availability, and Yahoo market signals. It may replace the players in the local 13-player plan and returns an ordered roster for all remaining slots, plus priority adjustments, a dollar adjustment between -$20 and +$20, and short reasons. Yahoo's public feed exposes whether a player note exists and when it changed, but not the note body; DraftLab passes only that metadata and explicitly forbids the model from inventing note content. The server derives final ceilings from bounded adjustments and the local planner still enforces positional eligibility, remaining budget, $1 minimums, and Yahoo's legal maximum.

When the shortlist contains projection-only players, the adviser can use OpenAI's web-search tool for a small research set. This includes newly drafted rookies such as AJ Dybantsa as well as veterans returning without a usable completed-season sample. The prompt asks for current role, draft position, pre-NBA production, injury context, and reputable recent reporting, and requires visible source links for web-supported advice. Research is supporting evidence; uncertain roles and hype remain discounted.

Roster selection is explicitly the first AI task: maximize risk-adjusted points, durability, upside, and positional fit. Price adjustments are calculated only after the players are chosen, so a cheaper but clearly inferior player should not displace an affordable superior option. Web research runs only on the first successful plan for an auction; later post-sale refreshes skip repeated research for faster, more reliable replanning. If the initial web-enabled request times out or returns no structured plan, the server automatically retries once without web search.

AI output is deliberately compact and receives a larger output-token allowance. If a response is still truncated or contains incomplete JSON, DraftLab retries once with stricter length limits. If both attempts fail, the endpoint returns the existing numeric roster plan instead of breaking the auction screen; the UI clearly labels that fallback and keeps any previous valid AI roster preference.

## Data Source

DraftLab uses ESPN's public, unauthenticated web statistics endpoint. It also reads the same public Yahoo Salary Cap draft-analysis data that powers Yahoo's `Avg $` column. ESPN history is cached for seven days and Yahoo market prices for six hours. Neither public web endpoint is a formally supported developer API, so the application falls back to its own model values when either source is unavailable.

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

- Most recently completed season: 55%
- Previous season: 30%
- Third season: 15%

Players with fewer than five games in the latest completed season are excluded from the primary draft pool. Players with only one season of NBA evidence receive a 0.72 confidence multiplier; players with two seasons receive 0.90. This keeps rookies and other small-history players from being priced like equally productive veterans until a dedicated projection source is added.

Players found in Yahoo's current market feed but missing from the completed-season ESPN pool remain visible as projection-only players. Their initial local model price is capped at 65% of Yahoo's current market signal and they receive an uncertainty penalty in plan selection. The AI research pass may then move that price by up to $20 when current role, pre-NBA production, draft capital, injury context, and market evidence justify it. This keeps the default conservative while allowing newly drafted players to receive an evidence-backed price.

## Availability and Injury Risk

Because the league has no IL slots, historical availability receives a large penalty:

```text
Weighted GP = latest GP × 0.55 + previous GP × 0.30 + third GP × 0.15
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
5. Yahoo's average auction price is used as a market anchor, while the points model remains the larger part of the valuation because Yahoo averages are based on standard settings.
6. During the draft, recommended maximum bids adjust for roster needs, remaining budget pace, injury risk, observed market inflation, and the number of opponents who can still afford the player.
7. When another player is nominated, the maximum bid is capped again so the planned primary-target bid and $1 for every later roster opening remain protected.
8. The first two budget envelopes are intentionally larger. Only high-value players with an historical missed-game rate of 18% or less qualify for the full star premium; additional ceiling haircuts begin at 12% and become severe above 30-40%.

## Living Roster Plan

For the default 13-player format, the planner fills `PG, SG, G, SF, PF, F, C, C, Util, Util, BN, BN, BN`. The remaining budget is split into descending price envelopes, with the first two explicitly marked as star targets. Within each envelope, the model selects the best available player who fits an open slot using risk-adjusted value, positional need, Yahoo market price, and personal target stars. After selection, unused money is redistributed toward the strongest remaining targets up to their validated ceilings; only a small safety reserve remains unassigned.

The plan is recalculated after every recorded sale. A player bought by an opponent disappears from the plan and is replaced by the best affordable positional alternative; a player bought by the user is moved into the acquired portion of the plan at the actual sale price.

After a sale, AI price adjustments are marked stale because budgets and market inflation changed, but the remaining AI roster preferences stay active. If an opponent wins an AI-selected player, the local planner immediately fills that roster opening; pressing the AI button again produces a fully refreshed roster and ceilings.

The model never recommends a bid above Yahoo's legal maximum: current budget minus $1 for every empty roster spot remaining after the purchase.

## Yahoo-Style Salary Cap Flow

The live companion follows Yahoo's circular nomination order and assumes its normal salary-cap constraints:

- $200 starting budget
- 30-second nomination timer by default
- 20-second bid timer by default
- $1 minimum opening bid
- Nomination order rotates in a circle rather than snaking

DraftLab does not duplicate every bid: select the nominated player, follow the displayed ceiling, and enter only the winner and final price after the auction closes. The local countdown pauses at zero rather than assigning the player automatically, and both durations can be changed during setup.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

## Privacy

Credentials, OAuth tokens, local HTTPS certificates, cached API responses, and the active auction are not committed to Git. Yahoo access, when enabled, is read-only.
