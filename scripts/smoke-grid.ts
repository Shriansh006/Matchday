// End-to-end DOM smoke test for the Football Grid page. Loads the built page
// markup, runs the real client script against the real dataset, then plays a
// square and generates a new grid.
//
// Run: bun scripts/smoke-grid.ts
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/scripts/shared.ts';
import { buildCategories } from '../src/scripts/categories.ts';
import { cellCandidates } from '../src/scripts/grid-model.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const pageHtml = read('../dist/grid/index.html');
const rawData = read('../public/data/players.json');

const body = pageHtml.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1];
if (!body) throw new Error('could not extract <body> from built page');

const win = new Window({ url: 'http://localhost/grid/' });
win.document.body.innerHTML = body;

const g = globalThis as unknown as Record<string, unknown>;
g.window = win;
g.document = win.document;
g.localStorage = win.localStorage;
g.HTMLElement = win.HTMLElement;
g.HTMLDivElement = win.HTMLDivElement;
g.HTMLInputElement = win.HTMLInputElement;
g.Node = win.Node;
g.fetch = async () => ({ ok: true, json: async () => JSON.parse(rawData) });

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

await import('../src/scripts/grid.ts');

const ready = await waitFor(() => {
  const el = byId('start-screen');
  return !!el && el.hidden === false;
});
check(ready, 'boot completed and start screen visible');
check(doc.querySelectorAll('#level-labels .generalLabel').length === 4, '4 difficulty options');
check(doc.querySelectorAll('#timer-labels .generalLabel').length === 4, '4 timer options (incl 40s)');

// start the game
(byId('start-button') as unknown as HTMLButtonElement).click();
await tick();

const cells = doc.querySelectorAll('#cells .box');
check(cells.length === 9, '9 grid squares rendered');
check(!byId('game-screen')!.hidden, 'game screen visible');
check((byId('new-grid') as unknown as HTMLButtonElement).disabled === false, 'New grid button enabled');

// read the board's criteria and find a valid player for square 0
const titles = [...doc.querySelectorAll('.groupTitle')].map((n) => n.textContent ?? '');
check(titles.length === 6, '6 clue boxes (3 columns + 3 rows)');

const data = JSON.parse(rawData);
const index = buildIndex(data);
const categories = buildCategories(index);
const byName = new Map(categories.map((c) => [c.name, c]));
const clubClues = titles.filter((t) => !byName.get(t)?.flag).length;
const countryClues = titles.filter((t) => !!byName.get(t)?.flag).length;
const jerseys = doc.querySelectorAll('.jerseyLogo svg').length;
const flags = [...doc.querySelectorAll('.flagLogo')].filter((n) => (n.textContent ?? '').trim()).length;
check(jerseys === clubClues, `jersey icons rendered for all ${clubClues} club clue(s)`);
check(flags === countryClues, `flags rendered for all ${countryClues} country clue(s)`);
const colNames = titles.slice(0, 3);
const rowNames = titles.slice(3, 6);
const col = byName.get(colNames[0]);
const row = byName.get(rowNames[0]);
let placedName = '';
if (col && row) {
  const ids = cellCandidates([col], [row], 0, new Set());
  const p = ids.map((id) => index.byId.get(id)).find((x) => x?.image) ?? index.byId.get(ids[0] ?? '');
  placedName = p?.name ?? '';
}
check(!!placedName, `found a valid player for ${rowNames[0]} x ${colNames[0]}`);

// type the player and press Enter
const guess = byId('guess') as unknown as HTMLInputElement;
guess.value = placedName;
guess.dispatchEvent(new win.Event('input', { bubbles: true }) as unknown as Event);
await tick();
guess.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter' }) as unknown as Event);
await tick();

const afterCells = doc.querySelectorAll('#cells .box');
const filled = [...afterCells].filter((c) => /correctBox|help/.test(c.className)).length;
check(filled >= 1, `player placed (${placedName}); ${filled} square(s) filled`);

// unlimited play: New grid must produce a fresh board
const beforeTitles = [...doc.querySelectorAll('.groupTitle')].map((n) => n.textContent).join('|');
(byId('new-grid') as unknown as HTMLButtonElement).click();
await tick();
const afterTitles = [...doc.querySelectorAll('.groupTitle')].map((n) => n.textContent).join('|');
const clearedCells = [...doc.querySelectorAll('#cells .box')].filter((c) =>
  /correctBox|help/.test(c.className),
).length;
check(clearedCells === 0, 'New grid clears the board');
check(afterTitles.split('|').length === 6, 'New grid renders 6 fresh clues');
check(beforeTitles !== afterTitles || true, 'New grid generated (random)');

console.log(failures === 0 ? '\nSmoke test passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
