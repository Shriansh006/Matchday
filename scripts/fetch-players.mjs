// Resolves the player names scraped from futbol-11 against Wikidata and emits
// a single, self-contained dataset.
//
//   data/source-names.json   ->   public/data/players.json
//
// Design notes:
//  - Pass 1 resolves names by exact label / alias (rdfs:label|skos:altLabel)
//    plus instance-of footballer (P106 = Q937857). No API key, CC0 data.
//  - Pass 2 rescues whatever is left (transliterations, hyphen/space variants
//    like "Wan Bissaka" -> "Wan-Bissaka") with the wbsearchentities search API,
//    then verifies each candidate is a footballer before accepting it.
//  - SPARQL returns one row per (player, country/position/club); rows are
//    aggregated in JS. (Grouping in SPARQL breaks the label service, so we
//    deliberately don't GROUP_CONCAT here.)
//  - P54 is read through its statement node (p:P54/ps:P54), not the truthy
//    `wdt:P54`, so a player keeps *every* club they turned out for. wdt: only
//    yields preferred-rank statements when they exist, which for many active
//    players is just their current club (e.g. Messi -> Inter Miami only).
//  - Everything is batched, cached under data/.cache (resumable), and retried
//    with backoff (batches are split on failure so one bad query can't sink it).
//  - Output is compact JSON so it stays small enough to ship client-side.
//
// Usage:
//   node scripts/fetch-players.mjs                 # full run
//   node scripts/fetch-players.mjs --limit 300     # first 300 names only
//   SKIP_SEARCH=1 node scripts/fetch-players.mjs   # pass 1 only
//   BATCH_SIZE=120 SLEEP_MS=500 node scripts/fetch-players.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const NAMES_FILE = resolve(ROOT, 'data/source-names.json');
const NICKNAMES_FILE = resolve(ROOT, 'data/source-nicknames.json');
const OUT_FILE = resolve(ROOT, 'public/data/players.json');
const UNMATCHED_FILE = resolve(ROOT, 'data/unmatched.json');
const CACHE_DIR = resolve(ROOT, 'data/.cache');
const SEARCH_CACHE = resolve(CACHE_DIR, 'search.json');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const WD_API = 'https://www.wikidata.org/w/api.php';
const UA =
  'football-11-dataset-builder/1.0 (https://github.com/Shriansh006; SPARQL)';
const FOOTBALLER = 'Q937857';
const LANGS = '"en,es,fr,de,pt,it,nl,tr"';
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 150);
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 400);
const SEARCH_CONCURRENCY = Number(process.env.SEARCH_CONCURRENCY ?? 6);
const SKIP_SEARCH = process.env.SKIP_SEARCH === '1';

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );

async function pMap(items, mapper, limit) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const SELECT_VARS =
  '?player ?playerLabel ?dob ?height ?image ?sportCountryLabel ?countryLabel ?positionLabel ?clubLabel';

const OPTIONALS = `OPTIONAL { ?player wdt:P1532 ?sportCountry . }
  OPTIONAL { ?player wdt:P27  ?country . }
  OPTIONAL { ?player wdt:P413 ?position . }
  OPTIONAL { ?player p:P54 ?clubStatement . ?clubStatement ps:P54 ?club . }
  OPTIONAL { ?player wdt:P569 ?dob . }
  OPTIONAL { ?player wdt:P2048 ?height . }
  OPTIONAL { ?player wdt:P18  ?image . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language ${LANGS}. }`;

function queryByNames(names) {
  const values = names.map((n) => `"${n.replace(/["\\]/g, '')}"@en`).join(' ');
  return `SELECT ?name ${SELECT_VARS}
WHERE {
  VALUES ?name { ${values} }
  ?player rdfs:label|skos:altLabel ?name ;
          wdt:P106 wd:${FOOTBALLER} .
  ${OPTIONALS}
}`;
}

function queryByItems(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  return `SELECT ${SELECT_VARS}
WHERE {
  VALUES ?player { ${values} }
  ?player wdt:P106 wd:${FOOTBALLER} .
  ${OPTIONALS}
}`;
}

async function wdqs(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      accept: 'application/sparql-results+json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ query }),
  });
  if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// Run `build(units)` against WDQS, splitting on failure and retrying with
// exponential backoff so one bad/oversized query can't sink the whole run.
async function safeQuery(units, build, attempt = 1) {
  try {
    return (await wdqs(build(units))).results.bindings;
  } catch (err) {
    if (units.length > 1) {
      const mid = Math.ceil(units.length / 2);
      const a = await safeQuery(units.slice(0, mid), build, attempt);
      const b = await safeQuery(units.slice(mid), build, attempt);
      return [...a, ...b];
    }
    if (attempt > 4) throw err;
    const wait = 2000 * 2 ** (attempt - 1);
    console.warn(`    retry ${attempt} in ${wait}ms (${err.message})`);
    await sleep(wait);
    return safeQuery(units, build, attempt + 1);
  }
}

const val = (b, k) => b[k]?.value;

function toImage(url) {
  if (!url) return undefined;
  const sep = url.includes('?') ? '&' : '?';
  return `${url.replace('http://', 'https://')}${sep}width=400`;
}

function emptyPlayer(id, name) {
  return {
    id,
    name,
    label: name,
    country: undefined,
    countries: [],
    sportCountries: [],
    positions: [],
    clubs: [],
    dob: undefined,
    height: undefined,
    image: undefined,
  };
}

// Fold a flat row (one country/position/club per row) into the player map.
function collect(bindings) {
  const byId = new Map();
  for (const b of bindings) {
    const id = val(b, 'player').split('/').pop();
    let p = byId.get(id);
    if (!p) {
      p = emptyPlayer(id, val(b, 'name'));
      byId.set(id, p);
    }
    p.name = p.name ?? val(b, 'name');
    const label = val(b, 'playerLabel');
    if (label && !/^Q\d+$/.test(label)) p.label = label;
    p.dob = p.dob ?? val(b, 'dob')?.slice(0, 10);
    p.height = p.height ?? (val(b, 'height') ? Number(val(b, 'height')) : undefined);
    p.image = p.image ?? toImage(val(b, 'image'));

    const country = val(b, 'countryLabel');
    if (country && !p.countries.includes(country)) p.countries.push(country);
    const sportCountry = val(b, 'sportCountryLabel');
    if (sportCountry && !p.sportCountries.includes(sportCountry))
      p.sportCountries.push(sportCountry);
    const position = val(b, 'positionLabel');
    if (position && !p.positions.includes(position)) p.positions.push(position);
    const club = val(b, 'clubLabel');
    if (club && !p.clubs.includes(club)) p.clubs.push(club);
    // Sporting nationality (P1532) is what matters in a football context;
    // fall back to citizenship (P27) for players who don't have it.
    p.country = p.sportCountries[0] ?? p.countries[0];
  }
  return byId;
}

async function searchEntities(name) {
  const url =
    `${WD_API}?` +
    new URLSearchParams({
      action: 'wbsearchentities',
      search: name,
      language: 'en',
      uselang: 'en',
      limit: '5',
      format: 'json',
      origin: '*',
    });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (res.ok) {
      const data = await res.json();
      return (data.search ?? []).map((s) => s.id);
    }
    if (res.status !== 429 && res.status < 500) return [];
    await sleep(1000 * attempt);
  }
  return [];
}

async function processNameBatch(names, index) {
  const cacheFile = resolve(CACHE_DIR, `batch-${String(index).padStart(4, '0')}.json`);
  if (existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, 'utf8'));
  const bindings = await safeQuery(names, queryByNames);
  const players = [...collect(bindings).values()];
  const matched = [
    ...new Set(bindings.map((b) => val(b, 'name')).filter(Boolean)),
  ];
  const result = { players, matched, requested: names };
  await writeFile(cacheFile, JSON.stringify(result));
  return result;
}

// Pass 2: fuzzy search for names pass 1 could not resolve, then verify.
async function resolveRemaining(unmatched) {
  if (!unmatched.length) return { players: [], matched: new Map() };
  console.log(`\npass 2: fuzzy search for ${unmatched.length} unmatched names`);

  const cache = existsSync(SEARCH_CACHE)
    ? JSON.parse(await readFile(SEARCH_CACHE, 'utf8'))
    : {};

  const todo = unmatched.filter((n) => !(n in cache));
  if (todo.length) {
    await pMap(
      todo,
      async (name) => {
        cache[name] = await searchEntities(name);
        await sleep(60);
      },
      SEARCH_CONCURRENCY,
    );
    await writeFile(SEARCH_CACHE, JSON.stringify(cache));
  }

  const candidateQids = [...new Set(Object.values(cache).flat())];
  console.log(`  verifying ${candidateQids.length} candidates...`);

  const verified = new Map();
  for (const batch of chunk(candidateQids, BATCH_SIZE)) {
    const bindings = await safeQuery(batch, queryByItems);
    for (const [id, p] of collect(bindings)) verified.set(id, p);
    await sleep(SLEEP_MS);
  }
  console.log(`  ${verified.size} candidates are footballers`);

  const players = [];
  const matched = new Map();
  const usedQids = new Set();
  for (const name of unmatched) {
    const hit = (cache[name] ?? []).find((q) => verified.has(q));
    if (!hit || usedQids.has(hit)) continue;
    usedQids.add(hit);
    const p = { ...verified.get(hit), name };
    players.push(p);
    matched.set(name, p);
  }
  console.log(`  recovered ${players.length} more players`);
  return { players, matched };
}

async function main() {
  if (!existsSync(NAMES_FILE)) {
    throw new Error(`missing ${NAMES_FILE} — run: node scripts/extract-names.mjs`);
  }
  const allNames = JSON.parse(await readFile(NAMES_FILE, 'utf8'));
  const names = allNames.slice(0, LIMIT === Infinity ? allNames.length : LIMIT);
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(dirname(OUT_FILE), { recursive: true });

  const batches = chunk(names, BATCH_SIZE);
  console.log(`resolving ${names.length} names in ${batches.length} batches of ≤${BATCH_SIZE}\n`);

  const players = new Map();
  const matchedNames = new Set();
  const t0 = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const cached = existsSync(
      resolve(CACHE_DIR, `batch-${String(i).padStart(4, '0')}.json`),
    );
    process.stdout.write(
      `[${String(i + 1).padStart(3)}/${batches.length}] ${batches[i].length} names${cached ? ' (cached)' : ''} ... `,
    );
    const { players: bp, matched } = await processNameBatch(batches[i], i);
    for (const p of bp) {
      const existing = players.get(p.id);
      if (existing) {
        existing.countries = [...new Set([...existing.countries, ...p.countries])];
        existing.sportCountries = [
          ...new Set([...existing.sportCountries, ...p.sportCountries]),
        ];
        existing.positions = [...new Set([...existing.positions, ...p.positions])];
        existing.clubs = [...new Set([...existing.clubs, ...p.clubs])];
        existing.country = existing.sportCountries[0] ?? existing.countries[0];
      } else {
        players.set(p.id, p);
      }
    }
    matched.forEach((n) => matchedNames.add(n));
    console.log(`${bp.length} players, ${players.size} total`);
    if (!cached) await sleep(SLEEP_MS);
  }

  let unmatched = names.filter((n) => !matchedNames.has(n));
  if (!SKIP_SEARCH && unmatched.length) {
    const { players: extra, matched } = await resolveRemaining(unmatched);
    for (const p of extra) players.set(p.id, p);
    for (const n of matched.keys()) matchedNames.add(n);
    unmatched = names.filter((n) => !matchedNames.has(n));
  }

  const list = [...players.values()].sort((a, b) => a.name.localeCompare(b.name));
  const nicknameMap = existsSync(NICKNAMES_FILE)
    ? JSON.parse(await readFile(NICKNAMES_FILE, 'utf8'))
    : {};
  const withNicknames = list.map((p) =>
    nicknameMap[p.name] ? { ...p, nickname: nicknameMap[p.name] } : p,
  );
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'Wikidata (CC0)',
      sourceUrl: 'https://www.wikidata.org',
      matchStrategy: 'exact label/alias + fuzzy search, verified P106=Q937857',
      requested: names.length,
      matched: list.length,
      unmatched: unmatched.length,
    },
    players: withNicknames,
  };
  await writeFile(OUT_FILE, JSON.stringify(out));
  await writeFile(UNMATCHED_FILE, JSON.stringify(unmatched, null, 0) + '\n');

  const mb = (Buffer.byteLength(JSON.stringify(out)) / 1024 / 1024).toFixed(2);
  const rich = list.filter((p) => p.image || p.clubs.length || p.country).length;
  console.log(
    `\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s\n` +
      `  players  : ${list.length} (${((list.length / names.length) * 100).toFixed(1)}% of names)\n` +
      `  with data: ${rich}\n` +
      `  unmatched: ${unmatched.length} -> ${UNMATCHED_FILE}\n` +
      `  output   : ${OUT_FILE} (${mb} MB raw)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
