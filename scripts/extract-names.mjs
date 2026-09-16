// Downloads the futbol-11 JS bundle and extracts the unique player names (and
// their nicknames) it ships with.
// Output: data/source-names.json, data/source-nicknames.json
//
// Usage: node scripts/extract-names.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../data/source-names.json');
const OUT_NICK = resolve(__dirname, '../data/source-nicknames.json');

const HOMEPAGES = ['https://futbol11.com/', 'https://futbol-11.com/'];
const UA =
  'football-11-dataset-builder/1.0 (https://github.com/Shriansh006; data pipeline)';

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

async function findBundle() {
  let lastErr;
  for (const page of HOMEPAGES) {
    try {
      const html = await getText(page);
      const m = html.match(/src="([^"]*\/js\/app\.[a-f0-9]+\.js)"/i);
      if (!m) throw new Error('app bundle not found in HTML');
      return new URL(m[1], page).href;
    } catch (err) {
      lastErr = err;
      console.warn(`  ! ${page}: ${err.message}`);
    }
  }
  throw lastErr;
}

const bundleUrl = await findBundle();
console.log(`bundle: ${bundleUrl}`);
const js = await getText(bundleUrl);
console.log(`downloaded ${(js.length / 1024 / 1024).toFixed(2)} MB of JS`);

const names = new Map();
const re = /"firstName":"([^"]*)","lastName":"([^"]*)"/g;
let m;
while ((m = re.exec(js))) {
  const full = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
  if (full.replace(/\s/g, '').length < 3) continue;
  names.set(full.toLowerCase(), full);
}

// nickname, where the same object also carries one
const nicknames = {};
const nre = /"firstName":"([^"]*)","lastName":"([^"]*)"[^}]*?"nickname":"([^"]*)"/g;
while ((m = nre.exec(js))) {
  const full = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
  const nick = m[3].trim();
  if (full && nick && nick.toLowerCase() !== full.toLowerCase()) nicknames[full] = nick;
}

const list = [...names.values()].sort((a, b) => a.localeCompare(b));
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(list, null, 0) + '\n');
await writeFile(OUT_NICK, JSON.stringify(nicknames, null, 0) + '\n');
console.log(`wrote ${list.length} unique player names -> ${OUT}`);
console.log(`wrote ${Object.keys(nicknames).length} nicknames -> ${OUT_NICK}`);
