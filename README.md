# Matchday

Two daily football games, built as a fully client-side static site (Astro) so it
deploys to Vercel with no backend:

- **The XI** — add one player from each of 11 random clubs to complete a lineup.
- **Football Grid** — fill a 3×3 grid where each square must satisfy both its row
  and column criterion (club × country).

Player data is generated from **Wikidata (CC0)** by the scripts in `scripts/`, so
there are no API keys, no runtime rate limits, and no copyright-encumbered
images (photos come from Wikimedia Commons).

> The site name lives in `src/config.ts` (`SITE_NAME`). Change it there to rebrand.

## Stack

- [Astro](https://astro.build) (static output) + TypeScript
- [Bun](https://bun.sh) for install/run (npm works too)
- No backend, no database — `localStorage` for streaks

## Commands

| Command          | Action                                           |
| :--------------- | :----------------------------------------------- |
| `bun install`    | Install dependencies                             |
| `bun dev`        | Dev server at `localhost:4321`                   |
| `bun build`      | Build to `./dist/`                               |
| `bun preview`    | Preview the production build                     |
| `bun run check`  | Type-check Astro + TypeScript                    |
| `bun test`       | Verify generated puzzles are solvable (see below) |
| `bun run test:ui`| Build + headless DOM smoke test of the grid page  |
| `bun run data`   | Regenerate the player dataset (names + Wikidata) |

## The games

### The XI (`/lineup`)

Modelled on futbol11.com/futbol11-clubs:

- 11 clubs appear **one at a time in random order** and you add a player from each
  into a formation position.
- Only **current players** can be added (a player's current club comes from
  Wikidata's P54 statements), and each player fills one of their own positions.
- If a player fits several open positions you choose the slot; if they fit one it
  is filled automatically. Every generated lineup is guaranteed solvable.
- The formation is drawn from 442 / 433 / 532 / 352 / 343.
- **Easy** (top clubs) or **Normal** (all clubs), timers **No timer / 90s / 60s /
  40s**, a **white-flag give-up** and a **stats modal**.
- **Unlimited play** via the **New game** button (daily game still counts for the
  streak).

### Football Grid (`/grid`)

A close visual and behavioural match of futbol11.com/futbol11-grid
(Football Tic Tac Toe) — Poppins, the navy/gold/cyan palette, the 120px box
board, and the same components:

- A **3×3 grid**; the three columns and three rows are clubs/countries and each
  square needs a footballer who fits both.
- **Placement rule:** if a player fits exactly one square they go there; if they
  fit several squares but are the *only* valid answer for one of them, they're
  placed automatically (even if they fit elsewhere); otherwise you choose.
- 4 difficulties, matching the reference pools:

  | Difficulty | Draws from                                  |
  | :--------- | :------------------------------------------ |
  | Easy       | popular clubs + popular countries           |
  | Medium     | popular clubs only                          |
  | Hard       | popular clubs + countries + wider countries |
  | Legend     | everything, including the wider club pool   |

- Timers: **No timer / 90s / 60s / 40s** (box turns orange under 40s, red under 20s).
- **Reveal answers** after a loss, a **white-flag give-up** with confirmation, and
  a **stats modal** (played, wins, %, current streak, max streak, score
  distribution) — all stored in the browser.
- **Unlimited play:** the **New grid** button generates a fresh random grid at any
  time (and becomes **Play again** once a game ends). The daily seed is still the
  default board; only daily games count toward the streak.

> The reference generates the board without checking solvability. We keep the
> same generation rules but additionally require every grid to be completable
> with 9 *distinct* players (bipartite matching), so you can't be handed an
> impossible board.

> Instead of the reference's shirt image files we draw each club as an inline
> **SVG jersey in that club's colours** (with initials), and countries as flag
> emoji — so no trademarked crests or third-party assets are bundled.

## The data pipeline

```
scripts/extract-names.mjs            scripts/fetch-players.mjs
        │                                     │
   futbol-11 bundle                     Wikidata SPARQL
   (seed list of names)                  + wbsearchentities
        └──────────► data/source-names.json ──┴──► public/data/players.json
```

1. **`scripts/extract-names.mjs`** downloads the futbol-11 bundle and pulls out
   the `firstName`/`lastName` pairs it ships with. This is only a seed list —
   replace `data/source-names.json` with any names you like.
2. **`scripts/fetch-players.mjs`** resolves those names against Wikidata:
   - Pass 1 — exact `rdfs:label` / `skos:altLabel` match, restricted to
     footballers (`P106 = Q937857`).
   - Pass 2 — `wbsearchentities` fuzzy search for the leftovers (handles
     transliterations and hyphen/space variants), each candidate verified.
   - Batched, cached under `data/.cache/` (resumable), retried with backoff.

   Fields: `P1532` country for sport (falls back to `P27` citizenship), `P413`
   position, `P54` club(s), `P569` date of birth, `P2048` height, `P18` image.
3. **`scripts/fetch-current-clubs.mjs`** resolves each player's **current**
   club(s) from the `P54` statements (preferred rank, else no end date, else the
   latest start date), dropping national/youth sides. Output:
   `public/data/current-clubs.json`, used by The XI.

**Datasets:** 8,062 players (~3.1 MB raw / ~0.6 MB gzipped) · 6,491 with a
current club.

### Schema (`public/data/players.json`)

```jsonc
{
  "meta": { "generatedAt": "...", "source": "Wikidata (CC0)",
            "requested": 8331, "matched": 8062, "unmatched": 625 },
  "players": [
    {
      "id": "Q615",
      "name": "Lionel Messi",
      "label": "Lionel Messi",
      "country": "Argentina",          // P1532, else first P27
      "countries": ["Spain", "Italy", "Argentina"],
      "positions": ["midfielder", "forward"],
      "clubs": ["FC Barcelona", "Paris Saint-Germain FC", "Inter Miami CF"],
      // ^ every P54 statement (full club career), national teams filtered in-game
      "dob": "1987-06-24",
      "height": 169,
      "image": "https://commons.wikimedia.org/wiki/Special:FilePath/…?width=400"
    }
  ]
}
```

## Tests

- `bun test` — regenerates 150 grids per difficulty against the real dataset,
  asserts each is solvable and *playable to the end* using the real
  one/forced/choose rule, checks the difficulty pools, and generates 100 lineups
  per mode (Easy/Normal) asserting each is playable to the end. Exits non-zero
  on failure.
- `bun run test:ui` — builds the site and runs both games in a headless DOM
  (happy-dom): the grid boots, places a player and deals a new grid; The XI
  boots, shows 11 formation slots, adds a current player (via the choose-position
  flow) and starts a new game.

## Deploying to Vercel

Static output, zero config — import the repo and Vercel detects Astro (build
`astro build`, output `dist/`). Nothing else to set up.

## Licensing

- **Data:** Wikidata is CC0.
- **Images:** Wikimedia Commons via `Special:FilePath`; check each file's
  license or use a photo-free design.
- Avoid trademarked league/club logos and the "Wordle" name.

## Roadmap

- [x] Wikidata dataset pipeline (+ current clubs)
- [x] The XI — futbol11-clubs style: 11 clubs, current players, formation
      positions, Easy/Normal, timers, white flag, stats, unlimited play
- [x] Football Grid — futbol11-matching UI, Easy/Medium/Hard/Legend,
      No timer/90/60/40s, one/forced/choose rule, reveal answers, give-up flag,
      browser stats/streak, and unlimited grids via **New grid**
- [ ] Shareable emoji results
- [ ] Optional cross-device stats (serverless / Vercel KV)
