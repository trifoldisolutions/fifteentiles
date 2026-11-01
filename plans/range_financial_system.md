# Range & Tile Financial System

## Overview

This document covers how range and tile values are determined, how they change over time, and how the platform's financial model operates at the range level.

This is distinct from the map weight system, which uses aggregated range data as one of its signals. The financial system is the source of that data.

---

## Core concepts

### Tile

A tile is the smallest unit of space on a map. Each tile has a **base platform value** — a fixed floor price established by the platform.

### Range

A range is a group of contiguous tiles claimed, held, or auctioned as a single unit. A range's value is not simply the sum of its tiles' base values. It is influenced by:

- The auction or claim price set by the user
- The values of neighboring ranges (neighborhood effect)
- Time and decay (for ranges in auction)

### Holding

Holding a range is a non-ownership expression of interest. A user who holds a range is signaling they are watching it — possibly waiting for funds, waiting for a price change, or monitoring for opportunity. Holding does not block others from claiming or bidding. A held range is still available.

**Open questions:**
- Does holding have a cost or deposit?
- Does holding expire, or is it indefinite?
- Can multiple users hold the same range simultaneously?
- Is there a visible count of how many users hold a given range?

---

## Base platform value

Each tile has a floor value defined by the platform. This is the minimum value a tile can fall to — no range can be worth less per tile than this baseline.

**Open question:** How is the base platform value set? Is it a fixed constant (e.g. $1/tile), is it configurable per map, or does it vary by tile position or map density?

---

## Range value model

A range's current value is a function of:

1. **Intrinsic value** — the price at which the range was last claimed or auctioned
2. **Neighborhood value** — influence from adjacent ranges (see below)
3. **Decay** — for ranges sitting in auction without a buyer, value decreases over time toward the base platform value

The displayed value of a range at any moment reflects all three components.

---

## Neighborhood effect

Ranges do not exist in isolation. A range's value is partially influenced by the values of its neighboring ranges, similar to real estate: a high-value range raises the perceived floor of surrounding ranges.

### Principle

If a cluster of high-value ranges surrounds a range, that range's effective value is lifted. If a range sits in an area of low activity or low-value neighbors, its value is not boosted.

### Implications

- When a neighboring range changes value (claimed at a new price, decayed, or goes to auction), adjacent ranges must be recalculated.
- This means value changes can propagate outward from a single range event.
- The propagation needs a defined radius — how many tiles or range-steps away does the effect reach before it becomes negligible?

**Open questions:**
- What is the propagation radius? (e.g. direct neighbors only, or up to N range-steps?)
- What is the formula for the neighborhood contribution? (e.g. weighted average of neighbor values, dampened by distance?)
- Does the neighborhood effect apply upward only (neighbors can lift value but not pull it down), or bidirectionally?
- Is the effect proportional (e.g. 10% of neighbor average) or additive (e.g. neighbor average + flat bonus)?

---

## Auction mechanics

### Auction creation

A range enters auction when:
- A user claims a range and fails to set a name and redirection link within the 4-hour window
- Possibly other triggers (to be defined)

### Auction duration

Auctions do **not expire**. A range remains in auction status indefinitely until a buyer claims it.

### Auction value decay

While a range sits in auction with no buyer, its value decays gradually toward the base platform value.

The decay continues until the range's value reaches the base tile floor. At that point, the range can be reclaimed at the platform base price.

The neighborhood effect still applies during decay — if surrounding ranges are high-value, they slow or partially offset the decay of the auctioned range.

**Open questions:**
- What is the decay rate? (e.g. X% per day, per week?)
- Is the decay linear or exponential?
- When does a decayed auction range become claimable again — only at base value, or at any point during decay?
- Does winning an auction at a decayed price reset the range's value to the bid price, or to the decayed value?

### Auction speed as a signal

The speed from auction creation to first bid is used as a signal in the map weight system. A fast first bid indicates a healthy, desirable map. An auction that sits without any bid contributes to a lower map weight.

---

## Net worth

A map's net worth is the sum of all current range values on that map.

Net worth is **country-scoped**: each country has its own net worth figure for a given map, based on the aggregated values of ranges owned or held by users registered from that country.

This means:
- A map does not have a single net worth — it has a net worth per country.
- The platform-level net worth (global) is the total across all countries and all unowned/auction ranges.

**Open question:** How are ranges not attributed to any country (unclaimed tiles, or ranges owned by users with no registered country) handled in the net worth calculation? Are they excluded, or included in a global bucket?

---

## Value events that trigger recalculation

The following events should trigger a recalculation of range value and potentially propagate to neighbors:

- A range is claimed (new intrinsic value set)
- A range is auctioned (enters decay cycle)
- A range is purchased from auction (new intrinsic value set)
- A neighboring range changes value (neighborhood propagation)
- Scheduled decay tick (periodic decay update for all auctioned ranges)

---

## Relationship to the map weight system

The financial system feeds the following weight signals:

- **Net worth per country** — used as a platform-level map signal
- **Range price trend** — derived from intrinsic value changes over time
- **Auction bid density and speed** — derived from auction event history
- **Drop rate** — claims that fail to complete within the 4-hour window, causing a range to go to auction
