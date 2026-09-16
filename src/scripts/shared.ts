// Shared types, data loading, indexing and deterministic RNG used by both games.

export interface Player {
  id: string;
  name: string;
  label?: string;
  nickname?: string;
  country?: string;
  countries: string[];
  sportCountries?: string[];
  positions: string[];
  clubs: string[];
  dob?: string;
  height?: number;
  image?: string;
}

export interface GameData {
  meta: {
    generatedAt: string;
    source: string;
    requested: number;
    matched: number;
    unmatched: number;
  };
  players: Player[];
}

export interface Index {
  players: Player[];
  byId: Map<string, Player>;
  byKey: Map<string, Player>;
  names: string[];
  clubPlayers: Map<string, Set<string>>;
  countryPlayers: Map<string, Set<string>>;
  cell: Map<string, Map<string, number>>;
  clubsRanked: string[];
  countriesRanked: string[];
}

export async function loadData(url = '/data/players.json'): Promise<GameData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load player data (${res.status})`);
  return (await res.json()) as GameData;
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[åÅ]/g, 'a')
    .replace(/[öÖ]/g, 'o')
    .replace(/[äÄ]/g, 'a')
    .replace(/[ıİ]/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function lastNameOf(name: string): string {
  return name.trim().split(/\s+/).pop() ?? name;
}

/** The name to show a player as: nickname, else Wikidata label, else full name. */
export function displayName(p: Player): string {
  return p.nickname || p.label || p.name;
}

export interface SearchEntry {
  player: Player;
  keys: string[];
  lasts: string[];
}

export interface PlayerSearch {
  search(query: string, limit?: number): Player[];
}

/** Build a searchable index over players' names, nicknames and labels. */
export function buildSearch(players: Player[]): PlayerSearch {
  const entries: SearchEntry[] = players.map((player) => {
    const keys = new Set<string>();
    const lasts = new Set<string>();
    for (const s of [player.name, player.label, player.nickname]) {
      if (!s) continue;
      keys.add(normalizeName(s));
      lasts.add(normalizeName(lastNameOf(s)));
    }
    return { player, keys: [...keys], lasts: [...lasts] };
  });

  return {
    search(query: string, limit = 20): Player[] {
      const matches: Player[] = [];
      const exact: Player[] = [];
      for (const e of entries) {
        const hit =
          e.keys.some((k) => k.startsWith(query)) ||
          e.lasts.some((l) => l.startsWith(query));
        if (!hit) continue;
        const isExact = e.keys.includes(query) || e.lasts.includes(query);
        (isExact ? exact : matches).push(e.player);
      }
      return [...exact, ...matches].slice(0, limit);
    },
  };
}

const NATIONAL = /\bnational\b.*\bteam\b/i;

export function isNationalTeam(club: string): boolean {
  return NATIONAL.test(club) || /\bunder-\d+\b/i.test(club);
}

/** Club affiliations only — national/youth representative sides removed. */
export function clubList(p: Player): string[] {
  return p.clubs.filter((c) => !isNationalTeam(c));
}

export function playerName(p: Player | null | undefined): string {
  return p?.name ?? '';
}

export function buildIndex(data: GameData): Index {
  const players = data.players;
  const byId = new Map<string, Player>();
  const byKey = new Map<string, Player>();
  const clubPlayers = new Map<string, Set<string>>();
  const countryPlayers = new Map<string, Set<string>>();
  const cell = new Map<string, Map<string, number>>();

  for (const p of players) {
    byId.set(p.id, p);
    for (const n of new Set([p.name, p.label, p.nickname].filter(Boolean) as string[])) {
      const key = normalizeName(n);
      if (key && !byKey.has(key)) byKey.set(key, p);
    }
    const clubs = clubList(p);
    for (const c of clubs) {
      let set = clubPlayers.get(c);
      if (!set) clubPlayers.set(c, (set = new Set()));
      set.add(p.id);
    }
    if (p.country) {
      let set = countryPlayers.get(p.country);
      if (!set) countryPlayers.set(p.country, (set = new Set()));
      set.add(p.id);
      for (const c of clubs) {
        let row = cell.get(c);
        if (!row) cell.set(c, (row = new Map()));
        row.set(p.country, (row.get(p.country) ?? 0) + 1);
      }
    }
  }

  const clubsRanked = [...clubPlayers.keys()].sort(
    (a, b) => clubPlayers.get(b)!.size - clubPlayers.get(a)!.size,
  );
  const countriesRanked = [...countryPlayers.keys()].sort(
    (a, b) => countryPlayers.get(b)!.size - countryPlayers.get(a)!.size,
  );

  return {
    players,
    byId,
    byKey,
    names: [...new Set(players.map((p) => p.name))].sort((a, b) =>
      a.localeCompare(b),
    ),
    clubPlayers,
    countryPlayers,
    cell,
    clubsRanked,
    countriesRanked,
  };
}

export function cellCount(index: Index, club: string, country: string): number {
  return index.cell.get(club)?.get(country) ?? 0;
}

// --- deterministic helpers -------------------------------------------------

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function todaySeed(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// mulberry32 — small, fast, seedable PRNG for reproducible daily puzzles.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
