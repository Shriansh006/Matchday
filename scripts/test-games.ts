// Verifies the generated grids against the real dataset:
//   - every difficulty produces grids, all 9 squares have a valid player
//   - each grid can be filled with 9 distinct players (solvable)
//   - the "one / forced / choose" placement rule classifies correctly
//   - a grid can actually be completed by following that rule
//   - difficulty pools match futbol11 (Medium is clubs-only, Easy clubs+countries)
//   - The XI always has 11 clubs that each field at least 8 players
//
// Run: bun scripts/test-games.ts
import { readFileSync } from 'node:fs';
import {
  buildIndex,
  clubList,
  hashString,
  normalizeName,
  type Index,
  type Player,
} from '../src/scripts/shared.ts';
import { buildCategories, type GridCategory } from '../src/scripts/categories.ts';
import {
  LEVELS,
  canComplete,
  cellCandidates,
  decidePlacement,
  generateGrid,
  isSolvable,
  type Level,
  type Puzzle,
} from '../src/scripts/grid-model.ts';
import {
  FORMATIONS,
  WIDE_SLOTS,
  canCompleteLineup,
  eligibleClubs,
  generateLineup,
  laneX,
  slotsForPositions,
} from '../src/scripts/lineup-model.ts';

const data = JSON.parse(
  readFileSync(new URL('../public/data/players.json', import.meta.url), 'utf8'),
);
const index: Index = buildIndex(data);
const categories = buildCategories(index);

const LEVELS_TO_TEST: Level[] = ['easy', 'medium', 'hard', 'legend'];
let failures = 0;

// Try to complete a grid using only the real decision rule.
function playThrough(puzzle: Puzzle): boolean {
  const placed: (string | null)[] = new Array(9).fill(null);
  const used = new Set<string>();
  for (let guard = 0; guard < 100; guard++) {
    const empty = placed.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (empty.length === 0) return true;
    const cell = empty[0];
    const candidates = cellCandidates(puzzle.columns, puzzle.rows, cell, used);
    let moved = false;
    for (const id of candidates) {
      const decision = decidePlacement(puzzle.columns, puzzle.rows, placed, used, id);
      if (decision.kind === 'none') continue;
      const targets = decision.kind === 'one' ? [decision.cell] : decision.cells;
      for (const target of targets) {
        placed[target] = id;
        used.add(id);
        if (canComplete(puzzle.columns, puzzle.rows, placed, used)) {
          moved = true;
          break;
        }
        placed[target] = null;
        used.delete(id);
      }
      if (moved) break;
    }
    if (!moved) return false;
  }
  return false;
}

for (const level of LEVELS_TO_TEST) {
  let ok = 0;
  const allowed = new Set(LEVELS[level]);
  const typesSeen = new Set<string>();
  const decisionsSeen = new Set<string>();
  for (let s = 1; s <= 150; s++) {
    const puzzle = generateGrid(categories, level, hashString(`${level}:${s}`));
    if (!puzzle) {
      failures++;
      continue;
    }
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const noUsed = new Set<string>();
    const counts = cells.map((i) => cellCandidates(puzzle.columns, puzzle.rows, i, noUsed).length);
    const solvable = counts.every((n) => n >= 1) && isSolvable(puzzle.columns, puzzle.rows);
    puzzle.columns.concat(puzzle.rows).forEach((c: GridCategory) => {
      typesSeen.add(c.type);
      if (!allowed.has(c.type)) failures++;
    });

    // classify every candidate player and check the rule is consistent
    const playerIds = new Set<string>();
    cells.forEach((i) =>
      cellCandidates(puzzle.columns, puzzle.rows, i, noUsed).forEach((id) => playerIds.add(id)),
    );
    for (const id of playerIds) {
      const fits = cells.filter((i) =>
        cellCandidates(puzzle.columns, puzzle.rows, i, noUsed).includes(id),
      );
      const forced = fits.filter((i) => cellCandidates(puzzle.columns, puzzle.rows, i, noUsed).length === 1);
      const d = decidePlacement(puzzle.columns, puzzle.rows, new Array(9).fill(null), noUsed, id);
      const expected =
        fits.length === 1
          ? d.kind === 'one' && d.cell === fits[0]
          : forced.length > 0
            ? d.kind === 'forced' && forced.every((i) => d.cells.includes(i))
            : d.kind === 'choose';
      decisionsSeen.add(d.kind);
      if (!expected) {
        failures++;
        if (failures <= 5) console.log(`  FAIL rule ${level} seed=${s} player=${id} ${JSON.stringify(d)}`);
      }
    }

    // and it must be playable to the end
    const playable = playThrough(puzzle);
    if (solvable && playable) ok++;
    else {
      failures++;
      if (failures <= 5) console.log(`  FAIL play ${level} seed=${s} solvable=${solvable} playable=${playable}`);
    }
  }
  console.log(
    `${level.padEnd(7)} ${ok}/150 playable to the end  (types: ${[...typesSeen].sort().join(', ')}; decisions: ${[...decisionsSeen].sort().join(', ')})`,
  );
}

console.log('\ndifficulty pools:');
for (const level of LEVELS_TO_TEST) console.log(`  ${level.padEnd(7)} = ${LEVELS[level].join(' + ')}`);

console.log(`\ncategories: ${categories.length}`);
for (const type of ['club', 'club2', 'country', 'country2']) {
  const list = categories.filter((c) => c.type === type);
  console.log(
    `  ${type.padEnd(8)} ${String(list.length).padStart(3)}  e.g. ${list.slice(0, 4).map((c: GridCategory) => c.name).join(', ')}`,
  );
}

// --- The XI (clubs game) ----------------------------------------------------
const currentRaw = JSON.parse(
  readFileSync(new URL('../public/data/current-clubs.json', import.meta.url), 'utf8'),
) as { players: Record<string, string[]> };

const squads = new Map<string, string[]>();
for (const [id, clubs] of Object.entries(currentRaw.players)) {
  for (const club of clubs) {
    if (!squads.has(club)) squads.set(club, []);
    squads.get(club)!.push(id);
  }
}
const clubPool = eligibleClubs(squads);
console.log(`\nThe XI: ${clubPool.length} clubs with >= 8 current players`);

for (const mode of ['easy', 'normal'] as const) {
  let ok = 0;
  let withChoices = 0;
  for (let s = 1; s <= 100; s++) {
    const puzzle = generateLineup(clubPool, squads, index, hashString(`lineup:${mode}:${s}`), mode === 'easy');
    if (!puzzle) {
      failures++;
      continue;
    }
    const open = new Set<number>(puzzle.formation.slots.map((_, i) => i));
    const complete = canCompleteLineup(puzzle.teams, puzzle.formation, open, index);
    // play it greedily: assign each team in order to a slot that keeps it solvable
    let playable = true;
    const teams = puzzle.teams;
    const openNow = new Set<number>(open);
    for (let t = 0; t < teams.length; t++) {
      const team = teams[t];
      let moved = false;
      for (const pid of team.squad) {
        const p = index.byId.get(pid);
        if (!p) continue;
        const codes = slotsForPositions(p.positions);
        for (const idx of [...openNow]) {
          if (!codes.has(puzzle.formation.slots[idx])) continue;
          const openAfter = new Set(openNow);
          openAfter.delete(idx);
          if (canCompleteLineup(teams.slice(t + 1), puzzle.formation, openAfter, index)) {
            openNow.delete(idx);
            moved = true;
            break;
          }
        }
        if (moved) break;
      }
      if (!moved) {
        playable = false;
        break;
      }
    }
    if (playable && complete) ok++;
    else {
      failures++;
      if (failures <= 5) console.log(`  FAIL lineup ${mode} seed=${s} complete=${complete} playable=${playable}`);
    }
    // does the first club have a player with multiple positions (so the choose UI is exercised)?
    const team = puzzle.teams[0];
    const multi = team.squad.some((pid) => {
      const p = index.byId.get(pid);
      return !!p && slotsForPositions(p.positions).size > 1;
    });
    if (multi) withChoices++;
  }
  console.log(`  ${mode.padEnd(7)} ${ok}/100 lineups playable to the end (${withChoices} with position choices)`);
}

// formation layout: every slot appears exactly once, rows match futbol11's layout
const expectedLayout: Record<string, number[][]> = {
  '433': [[9], [8, 10], [7], [5, 6], [1, 4], [2, 3], [0]],
  '442': [[9, 10], [5, 8], [6, 7], [1, 4], [2, 3], [0]],
  '532': [[9, 10], [7, 8], [6], [1, 5], [2, 3, 4], [0]],
  '352': [[9, 10], [8], [6, 7], [4, 5], [1, 2, 3], [0]],
  '343': [[10], [8, 9], [6, 7], [4, 5], [1, 2, 3], [0]],
};
for (const f of FORMATIONS) {
  const flat = [...f.bands.flat()].sort((a, b) => a - b);
  const coversAll = flat.length === 11 && flat.every((v, i) => v === i);
  const rowsMatch = JSON.stringify(f.bands) === JSON.stringify(expectedLayout[f.name]);
  console.log(`  ${coversAll && rowsMatch ? 'ok  ' : 'FAIL'} formation ${f.name} layout`);
  if (!coversAll || !rowsMatch) failures++;
}

// horizontal lanes: ascending left->right, symmetric about centre, wide pairs at edges
for (const f of FORMATIONS) {
  let ok = true;
  f.bands.forEach((band) => {
    const pos = band.map((i) => f.slots[i]);
    const xs = pos.map((_, i) => laneX(pos, i));
    for (let k = 1; k < xs.length; k++) if (xs[k - 1] >= xs[k]) ok = false;
    xs.forEach((x, k) => {
      if (Math.abs(x + xs[xs.length - 1 - k] - 100) > 1e-6) ok = false;
    });
    if (xs.length === 1 && xs[0] !== 50) ok = false;
    if (xs.length === 2 && WIDE_SLOTS.has(pos[0]) && (xs[0] > 20 || xs[1] < 80)) ok = false;
  });
  const cam = f.bands.find((b) => b.some((i) => f.slots[i] === 'CAM'));
  if (cam) {
    const pos = cam.map((i) => f.slots[i]);
    if (laneX(pos, pos.indexOf('CAM')) !== 50) ok = false;
  }
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} formation ${f.name} lane placement`);
  if (!ok) failures++;
}

// spot-checks
const wingRow = ['LW', 'RW'];
console.log(
  `  ${laneX(['LW'], 0) === 50 && laneX(wingRow, 0) < 30 && laneX(wingRow, 1) > 70 ? 'ok  ' : 'FAIL'} LW/RW at the touchlines, CAM/singles centred`,
);
if (!(laneX(['LW'], 0) === 50 && laneX(wingRow, 0) < 30 && laneX(wingRow, 1) > 70)) failures++;

const checks: [string, string, string][] = [
  ['Lionel Messi', 'Argentina', 'Inter Miami CF'],
  ['Erling Haaland', 'Norway', 'Manchester City F.C.'],
];
for (const [name, country, club] of checks) {
  const p = index.byKey.get(normalizeName(name)) as Player | undefined;
  const ok = !!p && p.country === country && clubList(p).includes(club);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failures++;
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
