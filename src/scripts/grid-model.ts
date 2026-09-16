// DOM-free grid generation + solvability, mirroring futbol11's board logic.
//
// Rows and columns are drawn from categories (clubs/countries). A row is only
// eligible if it shares at least one player with each column, so every square
// always has a valid answer; generation also requires the 9 squares to be
// fillable with 9 *distinct* players.
import { mulberry32, shuffle, type Index } from './shared';
import type { CategoryType, GridCategory } from './categories';

export type Level = 'easy' | 'medium' | 'hard' | 'legend';

// Which category types each difficulty draws from (matches futbol11):
//   Easy   – popular clubs + popular countries
//   Medium – clubs only
//   Hard   – clubs + countries (popular + wider)
//   Legend – everything, including the wider club pool
export const LEVELS: Record<Level, CategoryType[]> = {
  easy: ['club', 'country'],
  medium: ['club'],
  hard: ['club', 'country', 'country2'],
  legend: ['club', 'country', 'country2', 'club2'],
};

export interface Puzzle {
  columns: GridCategory[];
  rows: GridCategory[];
}

export const LEVEL_LABELS: Record<Level, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  legend: 'Legend',
};

export const TIMER_OPTIONS = [
  { value: 'no timer', label: 'No timer' },
  { value: '90', label: '90s' },
  { value: '60', label: '60s' },
  { value: '40', label: '40s' },
] as const;

export type TimerOption = (typeof TIMER_OPTIONS)[number]['value'];

function shares(a: GridCategory, b: GridCategory): boolean {
  const [small, large] = a.players.size <= b.players.size ? [a.players, b.players] : [b.players, a.players];
  for (const id of small) if (large.has(id)) return true;
  return false;
}

/** Players valid for the square at `cell` (row-major), excluding `used`. */
export function cellCandidates(
  columns: GridCategory[],
  rows: GridCategory[],
  cell: number,
  used: Set<string>,
): string[] {
  const row = rows[Math.floor(cell / 3)];
  const col = columns[cell % 3];
  if (!row || !col) return [];
  const [small, large] =
    row.players.size <= col.players.size ? [row.players, col.players] : [col.players, row.players];
  const out: string[] = [];
  for (const id of small) {
    if (large.has(id) && !used.has(id)) out.push(id);
  }
  return out;
}

/**
 * True when the empty squares can still be filled by distinct, unused players
 * (bipartite matching via Kuhn's algorithm).
 */
export function canComplete(
  columns: GridCategory[],
  rows: GridCategory[],
  placed: (string | null)[],
  used: Set<string>,
): boolean {
  const empty: number[] = [];
  for (let i = 0; i < 9; i++) if (!placed[i]) empty.push(i);
  if (empty.length === 0) return true;

  const candidates = empty.map((i) => cellCandidates(columns, rows, i, used));
  if (candidates.some((c) => c.length === 0)) return false;

  const matchToCell = new Map<string, number>();
  const augment = (slot: number, seen: Set<string>): boolean => {
    for (const id of candidates[slot]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const other = matchToCell.get(id);
      if (other === undefined || augment(other, seen)) {
        matchToCell.set(id, slot);
        return true;
      }
    }
    return false;
  };

  for (let k = 0; k < empty.length; k++) {
    if (!augment(k, new Set())) return false;
  }
  return true;
}

export function isSolvable(columns: GridCategory[], rows: GridCategory[]): boolean {
  return canComplete(columns, rows, new Array(9).fill(null), new Set());
}

export type Placement =
  | { kind: 'none' }
  | { kind: 'one'; cell: number }
  | { kind: 'forced'; cells: number[] }
  | { kind: 'choose'; cells: number[] };

/**
 * The reference rule:
 *   - fits no square        -> rejected
 *   - fits exactly one       -> placed there
 *   - fits several, and is the *only* valid answer for one or more of them
 *                             -> placed automatically in each of those
 *   - fits several with no forced square -> the player chooses
 */
export function decidePlacement(
  columns: GridCategory[],
  rows: GridCategory[],
  placed: (string | null)[],
  used: Set<string>,
  playerId: string,
): Placement {
  const possible: string[][] = [];
  for (let i = 0; i < 9; i++) {
    possible[i] = placed[i] ? [] : cellCandidates(columns, rows, i, used);
  }
  const matches: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (!placed[i] && possible[i].includes(playerId)) matches.push(i);
  }
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'one', cell: matches[0] };
  const forced = matches.filter((i) => possible[i].length === 1);
  if (forced.length > 0) return { kind: 'forced', cells: forced };
  return { kind: 'choose', cells: matches };
}

export function generateGrid(
  categories: GridCategory[],
  level: Level,
  seed: number,
): Puzzle | null {
  const allowed = new Set(LEVELS[level]);
  const pool = categories.filter((c) => allowed.has(c.type));

  for (let attempt = 0; attempt < 800; attempt++) {
    const rnd = mulberry32((seed + attempt * 0x9e3779b9) >>> 0);
    const columns = shuffle(pool, rnd).slice(0, 3);
    if (columns.length < 3) continue;

    const colIds = new Set(columns.map((c) => c.id));
    const rowPool = pool.filter(
      (c) => !colIds.has(c.id) && columns.every((col) => shares(c, col)),
    );
    if (rowPool.length < 3) continue;

    const rows = shuffle(rowPool, rnd).slice(0, 3);
    if (isSolvable(columns, rows)) return { columns, rows };
  }
  return null;
}

/** convenience for callers that still have an Index lying around */
export type GridIndex = Index;
