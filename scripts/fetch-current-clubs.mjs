// Resolves each player's *current* club(s) from Wikidata's P54 statements.
//
// A P54 statement is treated as current when it is preferred rank, else has no
// end date (P582), else it is the statement with the latest start date (P580).
// National/youth representative teams are dropped.
//
// Output: public/data/current-clubs.json  ->  { players: { QID: [club, ...] } }
//
// Usage: node scripts/fetch-current-clubs.mjs [--limit N]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PLAYERS_FILE = resolve(ROOT, 'public/data/players.json');
const OUT_FILE = resolve(ROOT, 'public/data/current-clubs.json');
const CACHE_DIR = resolve(ROOT, 'data/.cache/current');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'football-11-dataset-builder/1.0 (https://github.com/Shriansh006; SPARQL)';
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 120);
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 300);

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;

const NATIONAL = /\bnational\b.*\bteam\b/i;
const YOUTH = /\bunder-\d+\b/i;
const isTeam = (c) => NATIONAL.test(c) || YOUTH.test(c);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function queryFor(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  return `SELECT ?player ?club ?clubLabel ?start ?end ?rank WHERE {
  VALUES ?player { ${values} }
  ?player p:P54 ?st .
  ?st ps:P54 ?club .
  OPTIONAL { ?st pq:P580 ?start . }
  OPTIONAL { ?st pq:P582 ?end . }
  OPTIONAL { ?st wikibase:rank ?rank . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,es,fr,de,pt,it,nl,tr". }
}`;
}

async function wdqs(qids) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      accept: 'application/sparql-results+json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ query: queryFor(qids) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).results.bindings;
}

async function safeQuery(qids, attempt = 1) {
  try {
    return await wdqs(qids);
  } catch (err) {
    if (qids.length > 1) {
      const mid = Math.ceil(qids.length / 2);
      const a = await safeQuery(qids.slice(0, mid), attempt);
      const b = await safeQuery(qids.slice(mid), attempt);
      return [...a, ...b];
    }
    if (attempt > 4) throw err;
    const wait = 2000 * 2 ** (attempt - 1);
    console.warn(`    retry ${attempt} in ${wait}ms (${err.message})`);
    await sleep(wait);
    return safeQuery(qids, attempt + 1);
  }
}

const val = (b, k) => b[k]?.value;

function currentClubsFor(statements) {
  const preferred = statements.filter((s) => s.preferred && !s.end).map((s) => s.club);
  if (preferred.length) return preferred;
  const open = statements.filter((s) => !s.end).map((s) => s.club);
  if (open.length) return open;
  const starts = statements.map((s) => s.start).filter(Boolean).sort();
  if (!starts.length) return statements.map((s) => s.club);
  const latest = starts[starts.length - 1];
  return statements.filter((s) => s.start === latest).map((s) => s.club);
}

async function processBatch(qids, index) {
  const cacheFile = resolve(CACHE_DIR, `batch-${String(index).padStart(4, '0')}.json`);
  if (existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, 'utf8'));
  const bindings = await safeQuery(qids);
  const byPlayer = new Map();
  for (const b of bindings) {
    const id = val(b, 'player')?.split('/').pop();
    const club = val(b, 'clubLabel');
    if (!id || !club) continue;
    if (!byPlayer.has(id)) byPlayer.set(id, []);
    byPlayer.get(id).push({
      club,
      start: val(b, 'start')?.slice(0, 10),
      end: val(b, 'end')?.slice(0, 10),
      preferred: (val(b, 'rank') ?? '').endsWith('PreferredRank'),
    });
  }
  const result = {};
  for (const [id, stmts] of byPlayer) {
    const current = currentClubsFor(stmts).filter((c) => !isTeam(c));
    result[id] = [...new Set(current)];
  }
  // Players with no P54 at all still need an entry so the caller can tell them apart.
  for (const id of qids) if (!(id in result)) result[id] = [];
  await writeFile(cacheFile, JSON.stringify(result));
  return result;
}

async function main() {
  if (!existsSync(PLAYERS_FILE)) throw new Error(`missing ${PLAYERS_FILE}`);
  const data = JSON.parse(await readFile(PLAYERS_FILE, 'utf8'));
  const qids = data.players.map((p) => p.id).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  await mkdir(CACHE_DIR, { recursive: true });

  const batches = chunk(qids, BATCH_SIZE);
  console.log(`resolving current clubs for ${qids.length} players in ${batches.length} batches\n`);

  const players = {};
  const t0 = Date.now();
  for (let i = 0; i < batches.length; i++) {
    const cached = existsSync(
      resolve(CACHE_DIR, `batch-${String(i).padStart(4, '0')}.json`),
    );
    process.stdout.write(
      `[${String(i + 1).padStart(3)}/${batches.length}] ${batches[i].length} players${cached ? ' (cached)' : ''} ... `,
    );
    Object.assign(players, await processBatch(batches[i], i));
    const withClub = Object.values(players).filter((v) => v.length).length;
    console.log(`${withClub} with a current club, ${Object.keys(players).length} processed`);
    if (!cached) await sleep(SLEEP_MS);
  }

  const clubs = new Map();
  for (const [id, list] of Object.entries(players)) {
    for (const club of list) {
      if (!clubs.has(club)) clubs.set(club, []);
      clubs.get(club).push(id);
    }
  }
  const ranked = [...clubs.entries()].sort((a, b) => b[1].length - a[1].length);

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'Wikidata (CC0)',
      players: Object.keys(players).length,
      withCurrentClub: Object.values(players).filter((v) => v.length).length,
      clubs: clubs.size,
    },
    players,
  };
  await writeFile(OUT_FILE, JSON.stringify(out));
  const mb = (Buffer.byteLength(JSON.stringify(out)) / 1024 / 1024).toFixed(2);
  console.log(
    `\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n` +
      `  players with a current club: ${out.meta.withCurrentClub}\n` +
      `  distinct clubs: ${clubs.size}\n` +
      `  top clubs: ${ranked.slice(0, 12).map(([c, ids]) => `${c} (${ids.length})`).join(', ')}\n` +
      `  output: ${OUT_FILE} (${mb} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
