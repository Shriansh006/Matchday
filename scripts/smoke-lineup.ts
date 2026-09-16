// End-to-end DOM smoke test for The XI (clubs game): loads the built page,
// runs the real client script against the real dataset, adds a current player
// to the first club, then starts a new game.
//
// Run: bun run test:ui
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { buildIndex, hashString, todaySeed } from '../src/scripts/shared.ts';
import { eligibleClubs, generateLineup, slotsForPositions, canCompleteLineup } from '../src/scripts/lineup-model.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const pageHtml = read('../dist/lineup/index.html');
const rawData = read('../public/data/players.json');
const rawCurrent = read('../public/data/current-clubs.json');

const body = pageHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1];
if (!body) throw new Error('could not extract <body> from built page');

const win = new Window({ url: 'http://localhost/lineup/' });
win.document.body.innerHTML = body;

const g = globalThis as unknown as Record<string, unknown>;
g.window = win;
g.document = win.document;
g.localStorage = win.localStorage;
g.HTMLElement = win.HTMLElement;
g.HTMLDivElement = win.HTMLDivElement;
g.HTMLInputElement = win.HTMLInputElement;
g.Node = win.Node;
g.fetch = async (url: unknown) => {
  const u = String(url);
  const json = u.includes('current-clubs') ? rawCurrent : rawData;
  return { ok: true, json: async () => JSON.parse(json) };
};

const doc = win.document as unknown as Document;
const byId = (id: string) => doc.getElementById(id) as unknown as HTMLElement | null;
const tick = () => new Promise((r) => setTimeout(r, 20));
let failures = 0;
const check = (cond: boolean, label: string) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
};
async function waitFor(fn: () => boolean, ms = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

await import('../src/scripts/lineup.ts');

const ready = await waitFor(() => {
  const el = byId('start-screen');
  return !!el && el.hidden === false;
});
check(ready, 'boot completed and start screen visible');
check(doc.querySelectorAll('#mode-labels .generalLabel').length === 2, '2 difficulty options (Easy/Normal)');
check(doc.querySelectorAll('#timer-labels .generalLabel').length === 4, '4 timer options');

(byId('start-button') as unknown as HTMLButtonElement).click();
await tick();

const slots = doc.querySelectorAll('#pitch .slotCircle');
check(slots.length === 11, '11 formation slots rendered');
check((byId('team-card')!.textContent ?? '').trim().length > 0, 'current club shown');
check((byId('new-game') as unknown as HTMLButtonElement).disabled === false, 'New game button enabled');

// work out the same puzzle the page just built and pick a valid first move
const data = JSON.parse(rawData);
const current = JSON.parse(rawCurrent) as { players: Record<string, string[]> };
const index = buildIndex(data);
const squads = new Map<string, string[]>();
for (const [id, clubs] of Object.entries(current.players)) {
  for (const club of clubs) {
    if (!squads.has(club)) squads.set(club, []);
    squads.get(club)!.push(id);
  }
}
const pool = eligibleClubs(squads);
const puzzle = generateLineup(pool, squads, index, hashString(`lineup:${todaySeed()}:normal`), false)!;
const team = puzzle.teams[0];
const open = new Set<number>(puzzle.formation.slots.map((_, i) => i));
let pickName = '';
let pickSlot = -1;
for (const pid of team.squad) {
  const p = index.byId.get(pid);
  if (!p) continue;
  const codes = slotsForPositions(p.positions);
  for (const idx of [...open]) {
    if (!codes.has(puzzle.formation.slots[idx])) continue;
    const openAfter = new Set(open);
    openAfter.delete(idx);
    if (canCompleteLineup(puzzle.teams.slice(1), puzzle.formation, openAfter, index)) {
      pickName = p.name;
      pickSlot = idx;
      break;
    }
  }
  if (pickSlot >= 0) break;
}
check(!!pickName, `found a valid current player for ${team.club}: ${pickName} (slot ${puzzle.formation.slots[pickSlot]})`);

const guess = byId('guess') as unknown as HTMLInputElement;
guess.value = pickName;
guess.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
await tick();
guess.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter' }) as unknown as Event);
await tick();

// a player who fits several open positions must be placed by clicking one
const options = doc.querySelectorAll('#pitch .slotCircle.option');
if (options.length) {
  check(options.length >= 1, `choose-position offered ${options.length} slot(s)`);
  (options[0] as unknown as HTMLElement).click();
  await tick();
}

const filled = doc.querySelectorAll('#pitch .slotCircle.filled').length;
check(filled >= 1, `player placed (${filled} slot(s) filled)`);
check((byId('message')!.textContent ?? '').includes('added'), `message confirms placement`);

// unlimited play
(byId('new-game') as unknown as HTMLButtonElement).click();
await tick();
const cleared = doc.querySelectorAll('#pitch .slotCircle.filled').length;
check(cleared === 0, 'New game clears the lineup');
check(doc.querySelectorAll('#pitch .slotCircle').length === 11, 'New game renders 11 fresh slots');

console.log(failures === 0 ? '\nLineup smoke test passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
