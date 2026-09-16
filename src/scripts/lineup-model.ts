// DOM-free model for the clubs game: formations, formation slots, mapping from
// a player's Wikidata positions to slots, and solvability checks.
import { mulberry32, shuffle, type Index } from './shared';

export const SLOT_LABELS: Record<string, string> = {
  GK: 'Goalkeeper',
  LB: 'Left Back',
  CB: 'Centre Back',
  RB: 'Right Back',
  LM: 'Left Mid',
  CM: 'Centre Mid',
  CDM: 'Defensive Mid',
  RM: 'Right Mid',
  CAM: 'Attacking Mid',
  LW: 'Left Wing',
  RW: 'Right Wing',
  ST: 'Striker',
};

// Wikidata position label -> formation slots it can fill.
const POSITION_SLOTS: Record<string, string[]> = {
  goalkeeper: ['GK'],
  goaltender: ['GK'],
  portero: ['GK'],
  'centre-back': ['CB'],
  'center-back': ['CB'],
  centerhalf: ['CB'],
  stopper: ['CB'],
  sweeper: ['CB'],
  libero: ['CB'],
  'full-back': ['LB', 'RB'],
  'wing-back': ['LB', 'RB'],
  'right-back': ['RB'],
  'right back': ['RB'],
  'left back': ['LB'],
  'left-back': ['LB'],
  defender: ['CB', 'LB', 'RB'],
  'defensive midfielder': ['CDM'],
  'defensive mid': ['CDM'],
  'central midfielder': ['CM'],
  midfielder: ['CM', 'CAM', 'CDM', 'LM', 'RM'],
  playmaker: ['CAM', 'CM'],
  medio: ['CM'],
  'attacking midfielder': ['CAM'],
  'wing half': ['CM', 'LM', 'RM'],
  'wide midfielder': ['LM', 'RM'],
  'left midfielder': ['LM'],
  'right midfielder': ['RM'],
  winger: ['LW', 'RW', 'LM', 'RM'],
  'left winger': ['LW', 'LM'],
  'right winger': ['RW', 'RM'],
  'inverted winger': ['LW', 'RW'],
  'left wing': ['LW'],
  extreme: ['LW', 'RW'],
  forward: ['ST', 'LW', 'RW'],
  attacker: ['ST', 'LW', 'RW'],
  'centre-forward': ['ST'],
  'centre forward': ['ST'],
  striker: ['ST'],
  delantero: ['ST'],
  'inside forward': ['ST', 'CAM'],
  'second striker': ['ST', 'CAM'],
};

export function slotsForPositions(positions: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of positions) {
    for (const s of POSITION_SLOTS[p.trim().toLowerCase()] ?? []) out.add(s);
  }
  return out;
}

export interface Formation {
  name: string;
  /** slot codes in lineup order (index 0 = GK) */
  slots: string[];
  /**
   * Rows top->bottom, each an array of slot indices left->right — exactly the
   * groups futbol11 lays out (e.g. 4-3-3 = ST / LW RW / CAM / CM CM / LB RB /
   * CB CB / GK).
   */
  bands: number[][];
}

export const FORMATIONS: Formation[] = [
  {
    name: '442',
    slots: ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CDM', 'RM', 'ST', 'ST'],
    bands: [[9, 10], [5, 8], [6, 7], [1, 4], [2, 3], [0]],
  },
  {
    name: '433',
    slots: ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'CAM', 'LW', 'ST', 'RW'],
    bands: [[9], [8, 10], [7], [5, 6], [1, 4], [2, 3], [0]],
  },
  {
    name: '532',
    slots: ['GK', 'LB', 'CB', 'CB', 'CB', 'RB', 'CDM', 'CM', 'CM', 'ST', 'ST'],
    bands: [[9, 10], [7, 8], [6], [1, 5], [2, 3, 4], [0]],
  },
  {
    name: '352',
    slots: ['GK', 'CB', 'CB', 'CB', 'CDM', 'CDM', 'LM', 'RM', 'CAM', 'ST', 'ST'],
    bands: [[9, 10], [8], [6, 7], [4, 5], [1, 2, 3], [0]],
  },
  {
    name: '343',
    slots: ['GK', 'CB', 'CB', 'CB', 'CM', 'CM', 'LM', 'RM', 'LW', 'RW', 'ST'],
    bands: [[10], [8, 9], [6, 7], [4, 5], [1, 2, 3], [0]],
  },
];

export function formationByName(name: string): Formation {
  return FORMATIONS.find((f) => f.name === name) ?? FORMATIONS[0];
}

// Wide slots hug the touchlines; others sit narrower.
export const WIDE_SLOTS = new Set(['LB', 'RB', 'LM', 'RM', 'LW', 'RW']);

/**
 * Horizontal lane (as a % of pitch width) for the slot at `i` in a row whose
 * position codes are `positions` — so left/right stay at the edges, central
 * pairs sit narrower and a lone slot (CAM, ST, GK) is centred.
 */
export function laneX(positions: string[], i: number): number {
  const n = positions.length;
  if (n === 1) return 50;
  if (n === 2) {
    const wide = WIDE_SLOTS.has(positions[0]);
    if (i === 0) return wide ? 14 : 34;
    return wide ? 86 : 66;
  }
  if (n === 3) return [15, 50, 85][i] ?? 50;
  if (n === 4) return [10, 37, 63, 90][i] ?? 50;
  return [8, 29, 50, 71, 92][i] ?? 50;
}

export interface Team {
  club: string;
  /** player ids currently at the club */
  squad: string[];
}

/** Slot *indices* a team could use, given its current squad. */
export function teamSlotIndices(
  team: Team,
  formation: Formation,
  index: Index,
  open: Set<number>,
): Set<number> {
  const codes = new Set<string>();
  for (const id of team.squad) {
    const p = index.byId.get(id);
    if (!p) continue;
    for (const s of slotsForPositions(p.positions)) codes.add(s);
  }
  const out = new Set<number>();
  for (const i of open) if (codes.has(formation.slots[i])) out.add(i);
  return out;
}

/** Can every remaining team be assigned a distinct open slot (by index)? */
export function canCompleteLineup(
  teams: Team[],
  formation: Formation,
  open: Set<number>,
  index: Index,
): boolean {
  if (teams.length === 0) return true;
  if (teams.length > open.size) return false;

  const options = teams.map((t) => [...teamSlotIndices(t, formation, index, open)]);
  if (options.some((o) => o.length === 0)) return false;

  const matchSlot = new Map<number, number>();
  const augment = (team: number, seen: Set<number>): boolean => {
    for (const slot of options[team]) {
      if (seen.has(slot)) continue;
      seen.add(slot);
      const other = matchSlot.get(slot);
      if (other === undefined || augment(other, seen)) {
        matchSlot.set(slot, team);
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < teams.length; i++) {
    if (!augment(i, new Set())) return false;
  }
  return true;
}

export interface LineupPuzzle {
  formation: Formation;
  teams: Team[];
}

/** Clubs with enough current players to field a lineup. */
export function eligibleClubs(squads: Map<string, string[]>, minSquad = 8): string[] {
  return [...squads.entries()]
    .filter(([, ids]) => ids.length >= minSquad)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([club]) => club);
}

export function generateLineup(
  clubs: string[],
  squads: Map<string, string[]>,
  index: Index,
  seed: number,
  easy = false,
): LineupPuzzle | null {
  const pool = easy ? clubs.slice(0, 16) : clubs;
  if (pool.length < 11) return null;

  for (let attempt = 0; attempt < 600; attempt++) {
    const rnd = mulberry32((seed + attempt * 0x9e3779b9) >>> 0);
    const formation = FORMATIONS[Math.floor(rnd() * FORMATIONS.length)];
    if (!formation) continue;
    const picked = shuffle(pool, rnd).slice(0, 11);
    const teams: Team[] = picked.map((club) => ({ club, squad: squads.get(club) ?? [] }));
    const allSlots = new Set(formation.slots.map((_, i) => i));
    if (canCompleteLineup(teams, formation, allSlots, index)) return { formation, teams };
  }
  return null;
}
