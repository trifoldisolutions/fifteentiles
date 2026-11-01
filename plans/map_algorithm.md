# Map Loading and Ranking Algorithm

## Current starting point

We are at the beginning of the ranking system, so the platform should keep the logic simple and explicit.

On page load, map selection should follow this order:

1. Alphabetical order is the default fallback.
2. If the user has a known last visited map, that map should be loaded first.
3. In the future, a composite ranking score should determine order more intelligently.

Alphabetical order is the least favored parameter. It only exists as the baseline when there is not enough signal yet.

## Anonymous user session

Every visitor should receive an anonymous user session.

- The session should be created automatically when the user loads the page.
- The session should persist for up to 1 hour of inactivity.
- If there is activity, the session lifetime should roll forward.
- The session should store at least the last visited map.
- Anonymous visitors should be stored in the `users` collection with `type: "anon"`.
- Anonymous visitors should be identified by an `anonymousId`.
- If the `users` collection does not exist yet, it should be created by the application automatically.

This allows the platform to reopen the last map the user was on without requiring authentication.

## Meaning of `lastSeenSessionId`

`lastSeenSessionId` would not be the user identity.

That role belongs to `anonymousId`.

Instead, `lastSeenSessionId` would represent the user's current or most recent activity window.

This means:

- `anonymousId` answers: "Who is this anonymous user?"
- `lastSeenSessionId` answers: "Which recent visit or activity session was this user in?"

### What it would bring

- session boundaries between separate visits
- better recency analysis across visits instead of one continuous lifetime
- cleaner return-rate measurement
- per-session dwell time
- per-session abandonment and continuity analysis
- easier aggregation of analytics at the visit level

### What it would not do

- it would not replace `anonymousId`
- it would not be required to remember the last visited map
- it would not be necessary for the current lightweight implementation

### Recommendation for now

At the current stage, `lastSeenSessionId` is optional and probably premature.

It becomes useful once the platform wants to analyze behavior per visit, not just per user.

## Important distinction: user signals vs platform signals

The first suggested parameters were mostly user-behavior signals. Those help personalize which map a specific user should see first, but they do not describe how well a map is performing on the platform overall.

We should separate ranking into two buckets:

### User-level signals

These answer:
"What should this specific person see first?"

Examples:

- last visited map
- visit frequency for that user
- dwell time for that user
- recent interaction depth
- current usage pattern across recent visits

### Platform-level signals

These answer:
"Which maps are performing well across the platform?"

Examples:

- total opens per map
- unique visitors per map
- return rate to a map
- average dwell time per map
- interaction rate per map
- conversion or completion rate tied to a map
- growth trend over time
- recency of platform-wide activity
- abandonment rate
- map-to-next-action success rate

## Suggested ranking structure

The ranking model should eventually be split into:

- personalization score
- platform score
- editorial or business score

Formula direction:

`final score = personalization score + platform score + editorial/business score`

## Practical phased rollout

### Phase 1

- Default to alphabetical order
- Override with last visited map for the anonymous session

### Phase 2

Add basic user-level personalization:

- recency
- frequency
- dwell time
- interaction depth

### Phase 3

Add platform-level performance signals:

- opens
- unique users
- retention
- dwell
- trend

### Phase 4

Add editorial controls:

- manual boost
- featured maps
- strategic priority

## Early composite scoring idea

A simple early scoring model could look like this:

`score = 0.35 recency + 0.25 frequency + 0.20 dwell + 0.10 interaction depth + 0.10 freshness`

At the beginning, the "last visited map" rule can still act as a strong override until enough ranking data has been collected.

## Implementation note

The code structure should support:

1. alphabetical fallback
2. user score
3. platform score
4. final composite score

This keeps the system extensible while starting with a very lightweight behavior.

---

## Map weight system

### Purpose

The map weight determines which map is presented to a **new visitor** — a visitor with no known history or session on the platform.

Since there are multiple maps, a purely random selection is undesirable. The weight system provides a principled signal to surface the most relevant map for that visitor. Random selection remains as the final fallback when no weight data is available.

### Weight structure

The weight is **not a single global value per map**. It is a **per-map, per-country score**.

Map XXX does not have one weight — it has a weight for France, a separate weight for Argentina, a separate weight for Brazil, and so on. Each country's weight for a given map is computed from how active users *from that country* are on that map.

For a new visitor from France: compute each map's weight using signals from French users, then present the highest-scoring map.

This is effectively collaborative filtering: show new visitors from country X the map that visitors from country X are most engaged with.

### Country region creation

- The platform will offer the maximum possible list of countries in the region dropdown.
- A country region is **only created in the weight system when at least one user registers from that country**.
- Until then, that country has no weight data, and the fallback (random) applies.

### Weight scale

The weight is a value between **-1 and 1**.

- Positive values indicate an active, growing, and engaging map.
- Zero is the neutral baseline.
- Negative values signal a map that may be stagnant, oversaturated, or showing signs of low user conviction.

### Signals

All signals are computed scoped to users from the visitor's country unless noted otherwise.

#### Positive signals

- **Visitor count** — number of users from that country who have visited the map
- **Claimed cell count** — total cells claimed by users from that country
- **Claim velocity** — speed at which held ranges are claimed; faster = stronger signal
- **Auction purchase speed** — how quickly auctioned ranges are bought
- **Number of ranges** — map density; more ranges indicate more activity and opportunity
- **Net worth of the map (country-scoped)** — sum of range values attributed to users registered from that country on that map; compared against the average country-scoped net worth across all maps
- **Redirection link CTR** — click-through rate on range redirection links from users in that country; since all ranges are required to have a redirection link, this signal is universal and comparable across all maps
- **Auction bid density** — how contested auctions are (bid count per auction, not just whether they close)
- **Range price trend** — whether average range prices are rising; increasing prices signal growing interest
- **Visitor-to-engagement conversion rate** — if fewer than 30% of registered users who visited the map currently own or hold at least one range, the map is flagged as low social proof; there is no upper penalty for high conversion or a crowded map
- **Distinct active users in last 24–48h** — recency of unique engagement
- **Average dwell time** — how long users from that country spend on the map

#### Negative signals

- **Drop rate** — ranges claimed but where the user never sets a name or redirection link within the allowed delay, causing the range to revert to auction; high drop rate signals low conviction and commitment
- **Slow claim velocity** — ranges held for a long time without being claimed
- **Slow auction close rate** — auctions that expire without a buyer
- **Net worth below average** — map whose country-scoped net worth is more than 25% below the average country-scoped net worth across all maps
- **Low recency** — time since last claim, last bid, or last auction close is too long

### Selection logic for new visitors

1. Detect the visitor's country.
2. If weight data exists for that country: select the map with the highest weight score for that country.
3. If no weight data exists for that country (region not yet created): fall back to random map selection.
4. If only one map exists: show that map directly.

### Relationship to the broader ranking model

The map weight system is distinct from the personalization and platform ranking described earlier in this document. It applies specifically to the **first impression moment** — the map shown to a new visitor who has no session history.

Once a visitor has a session, the existing ranking logic (last visited map, personalization score, platform score) takes over.
