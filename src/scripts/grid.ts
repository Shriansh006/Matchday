// Game 2 — Football Grid. Daily challenge matching futbol11.com/futbol11-grid
// (Easy/Medium/Hard/Legend, No timer/90s/60s/40s, the "one / forced / choose"
// placement rule, reveal answers, give-up flag, statistical modal) plus a
// "New grid" button so you can play as many grids as you like.
import {
  buildIndex,
  hashString,
  loadData,
  normalizeName,
  randomSeed,
  todaySeed,
  type Index,
  type Player,
} from './shared';
import { buildCategories, type GridCategory } from './categories';
import { jerseySvg } from './club-style';
import {
  LEVELS,
  LEVEL_LABELS,
  TIMER_OPTIONS,
  cellCandidates,
  decidePlacement,
  generateGrid,
  type Level,
  type Puzzle,
  type TimerOption,
} from './grid-model';

const K_DAILY = 'matchday:grid:daily';
const K_STATS = 'matchday:grid:stats';
const K_TIMER = 'matchday:grid:timer';

type Cell = string | 'option' | null;
type GameStatus = 'not started' | 'playing' | 'won' | 'lost';

interface DailyState {
  day: string;
  level: Level;
  timerMode: TimerOption;
  gameStatus: GameStatus;
  columnIds: string[];
  rowIds: string[];
  footballers: Cell[];
  help: number[];
  isDaily: boolean;
}

interface StatsData {
  stats: {
    played: number;
    wins: number;
    currentStreak: number;
    maxStreak: number;
    maxScore: number;
  };
  distribution: number[];
}

// --- DOM -------------------------------------------------------------------
const startScreen = document.getElementById('start-screen') as HTMLDivElement;
const gameScreen = document.getElementById('game-screen') as HTMLDivElement;
const levelLabels = document.getElementById('level-labels') as HTMLDivElement;
const timerLabels = document.getElementById('timer-labels') as HTMLDivElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const gridTop = document.getElementById('grid-top') as HTMLDivElement;
const rowHeads = document.getElementById('row-heads') as HTMLDivElement;
const cellsEl = document.getElementById('cells') as HTMLDivElement;
const guessEl = document.getElementById('guess') as HTMLInputElement;
const suggestionsEl = document.getElementById('suggestions') as HTMLUListElement;
const messageEl = document.getElementById('message') as HTMLParagraphElement;
const giveUpBtn = document.getElementById('give-up') as HTMLButtonElement;
const revealBtn = document.getElementById('reveal') as HTMLButtonElement;
const newGridBtn = document.getElementById('new-grid') as HTMLButtonElement;
const statsButton = document.getElementById('stats-button') as HTMLButtonElement;
const statsOverlay = document.getElementById('stats-overlay') as HTMLDivElement;
const statsContent = document.getElementById('stats-content') as HTMLDivElement;
const giveupOverlay = document.getElementById('giveup-overlay') as HTMLDivElement;

// --- state -----------------------------------------------------------------
let index: Index;
let categories: GridCategory[] = [];
const catById = new Map<string, GridCategory>();
let puzzle: Puzzle | null = null;
let daily: DailyState = defaultDaily();
let stats: StatsData = defaultStats();
let remaining = 90;
let timerId: number | null = null;
let pendingPlayer: string | null = null;
let suggestionIndex = 0;
let suggestions: Player[] = [];
let searchCache: { p: Player; name: string; last: string }[] = [];
let cellEls: HTMLDivElement[] = [];

function defaultDaily(): DailyState {
  return {
    day: todaySeed(),
    level: 'easy',
    timerMode: 'no timer',
    gameStatus: 'not started',
    columnIds: [],
    rowIds: [],
    footballers: new Array(9).fill(null),
    help: [],
    isDaily: true,
  };
}

function defaultStats(): StatsData {
  return {
    stats: { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, maxScore: 0 },
    distribution: new Array(10).fill(0),
  };
}

const player = (id: string): Player | undefined => index.byId.get(id);
const lastName = (name: string): string => name.trim().split(/\s+/).pop() ?? name;
const firstName = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setMessage(text: string, kind: '' | 'win' | 'lose' | 'warn' = ''): void {
  messageEl.textContent = text;
  messageEl.className = `gameMessage ${kind}`.trim();
}

// --- persistence -----------------------------------------------------------
function loadDaily(): DailyState {
  try {
    const raw = localStorage.getItem(K_DAILY);
    if (raw) {
      const saved = JSON.parse(raw) as DailyState;
      if (saved.day === todaySeed()) {
        return {
          ...defaultDaily(),
          ...saved,
          footballers: (saved.footballers ?? [])
            .slice(0, 9)
            .map((v) => (v === 'option' ? null : v)),
          help: saved.help ?? [],
        };
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  return defaultDaily();
}

function saveDaily(): void {
  localStorage.setItem(K_DAILY, JSON.stringify(daily));
}

function loadStats(): StatsData {
  try {
    const raw = localStorage.getItem(K_STATS);
    if (raw) return { ...defaultStats(), ...(JSON.parse(raw) as StatsData) };
  } catch {
    /* ignore */
  }
  return defaultStats();
}

function saveStats(): void {
  localStorage.setItem(K_STATS, JSON.stringify(stats));
}

function loadTimer(): number {
  const v = Number(localStorage.getItem(K_TIMER));
  return Number.isFinite(v) && v > 0 ? v : 90;
}

function saveTimer(): void {
  localStorage.setItem(K_TIMER, String(remaining));
}

// --- start screen ----------------------------------------------------------
function renderStart(): void {
  startScreen.hidden = false;
  gameScreen.hidden = true;
  statsButton.hidden = true;

  levelLabels.innerHTML = '';
  (Object.keys(LEVELS) as Level[]).forEach((level) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `generalLabel${daily.level === level ? ' activeLabel' : ''}`;
    btn.textContent = LEVEL_LABELS[level];
    btn.addEventListener('click', () => {
      daily.level = level;
      saveDaily();
      renderStart();
    });
    levelLabels.append(btn);
  });

  timerLabels.innerHTML = '';
  TIMER_OPTIONS.forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `generalLabel${daily.timerMode === opt.value ? ' activeLabel' : ''}`;
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      daily.timerMode = opt.value;
      saveDaily();
      renderStart();
    });
    timerLabels.append(btn);
  });
}

// --- rendering -------------------------------------------------------------
function groupBox(cat: GridCategory): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'box';
  const inner = document.createElement('div');
  inner.className = 'groupInner';

  const logo = document.createElement('div');
  logo.className = 'groupLogo';
  if (cat.flag) {
    logo.classList.add('flagLogo');
    logo.textContent = cat.flag;
  } else {
    logo.classList.add('jerseyLogo');
    logo.innerHTML = jerseySvg(cat.name, cat.id);
  }

  const title = document.createElement('p');
  title.className = 'groupTitle';
  title.textContent = cat.name;

  inner.append(logo, title);
  box.append(inner);
  return box;
}

function renderGame(): void {
  startScreen.hidden = true;
  gameScreen.hidden = false;
  statsButton.hidden = false;
  if (!puzzle) return;

  gridTop.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'box titleBox';
  const titleText = document.createElement('p');
  titleText.className = 'mainBoxTitle';
  titleText.innerHTML = 'Matchday <span class="span11">Grid</span>';
  title.append(titleText);
  if (daily.timerMode !== 'no timer') {
    const timer = document.createElement('p');
    timer.className = 'boxTimer';
    timer.id = 'box-timer';
    title.append(timer);
  }
  gridTop.append(title);
  puzzle.columns.forEach((c) => gridTop.append(groupBox(c)));

  rowHeads.innerHTML = '';
  puzzle.rows.forEach((r) => rowHeads.append(groupBox(r)));

  cellsEl.innerHTML = '';
  cellEls = [];
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'box box-footballer';
    cell.addEventListener('click', () => chooseOption(i));
    cellsEl.append(cell);
    cellEls[i] = cell;
  }
  for (let i = 0; i < 9; i++) renderCell(i);

  updateTimer();
  renderFooterState();
}

function renderCell(i: number): void {
  const cell = cellEls[i];
  const value = daily.footballers[i];
  cell.className = 'box box-footballer';
  cell.innerHTML = '';
  cell.title = '';

  const inner = document.createElement('div');
  inner.className = 'cellInner';

  if (value === 'option') {
    const opt = document.createElement('div');
    opt.className = 'option';
    inner.append(opt);
  } else if (value) {
    const p = player(value);
    if (p) {
      cell.classList.add(daily.help.includes(i) ? 'help' : 'correctBox');
      cell.title = p.name;
      if (p.image) {
        const img = document.createElement('img');
        img.className = 'footballerImage fade-in';
        img.src = p.image;
        img.alt = p.name;
        img.loading = 'lazy';
        inner.append(img);
        const np = document.createElement('div');
        np.className = 'nameParagraph';
        const npText = document.createElement('p');
        npText.textContent = lastName(p.name);
        np.append(npText);
        inner.append(np);
      } else {
        const nameBox = document.createElement('span');
        nameBox.className = 'footballerNameBox';
        const first = firstName(p.name);
        nameBox.innerHTML = `${first ? `${escapeHtml(first)} ` : ''}<span class="last">${escapeHtml(lastName(p.name))}</span>`;
        inner.append(nameBox);
      }
    }
  }

  cell.append(inner);
}

function renderFooterState(): void {
  const playing = daily.gameStatus === 'playing';
  guessEl.disabled = !playing;
  giveUpBtn.disabled = !playing;
  const filled = daily.footballers.filter(Boolean).length;
  revealBtn.hidden = !(daily.gameStatus === 'lost' && filled < 9);
  newGridBtn.textContent = playing ? 'New grid' : 'Play again';
}

function usedIds(): Set<string> {
  const used = new Set<string>();
  for (const v of daily.footballers) if (v && v !== 'option') used.add(v);
  return used;
}

// --- playing ---------------------------------------------------------------
function resetOptions(): void {
  for (let i = 0; i < 9; i++) {
    if (daily.footballers[i] === 'option') {
      daily.footballers[i] = null;
      renderCell(i);
    }
  }
  pendingPlayer = null;
}

function place(i: number, id: string, revealed = false): void {
  daily.footballers[i] = id;
  if (revealed && !daily.help.includes(i)) daily.help.push(i);
  renderCell(i);
}

function chooseOption(i: number): void {
  if (daily.footballers[i] !== 'option' || !pendingPlayer) return;
  const id = pendingPlayer;
  resetOptions();
  place(i, id);
  saveDaily();
  setMessage(`${lastName(player(id)!.name)} has been added in your selected spot`);
  checkWin();
}

function submitFootballer(id: string | null): void {
  if (daily.gameStatus !== 'playing') return;
  resetOptions();
  clearSuggestions();

  if (!id) {
    setMessage("Can't find that footballer");
    return;
  }
  const p = player(id);
  if (!p) return;
  const placed = daily.footballers.map((v) => (v === 'option' ? null : v));
  const decision = decidePlacement(puzzle!.columns, puzzle!.rows, placed, usedIds(), id);
  const last = lastName(p.name);

  if (decision.kind === 'none') {
    setMessage(`There's no place for ${last}`);
    return;
  }
  if (decision.kind === 'one') {
    place(decision.cell, id);
    setMessage(`${last} has been added on the only possible spot`);
  } else if (decision.kind === 'forced') {
    decision.cells.forEach((i) => place(i, id));
    setMessage(
      `${last} has been added ${decision.cells.length} ${decision.cells.length === 1 ? 'time' : 'times'}`,
    );
  } else {
    pendingPlayer = id;
    decision.cells.forEach((i) => {
      daily.footballers[i] = 'option';
      renderCell(i);
    });
    setMessage(`You have multiple choices where you can add ${last}`);
  }
  saveDaily();
  checkWin();
}

function checkWin(): void {
  if (daily.footballers.every(Boolean)) endGame('won');
}

function endGame(result: 'won' | 'lost'): void {
  if (daily.gameStatus !== 'playing') return;
  daily.gameStatus = result;
  stopTimer();

  const score = daily.footballers.filter(Boolean).length;
  stats.distribution[score] = (stats.distribution[score] ?? 0) + 1;
  if (result === 'won') {
    stats.stats.wins += 1;
    if (daily.isDaily) {
      stats.stats.currentStreak += 1;
      stats.stats.maxStreak = Math.max(stats.stats.maxStreak, stats.stats.currentStreak);
    }
    stats.stats.maxScore = Math.max(stats.stats.maxScore, score);
    setMessage('Congratulations, you won.', 'win');
  } else {
    if (daily.isDaily) stats.stats.currentStreak = 0;
    setMessage('Sorry, you lost today.', 'lose');
  }
  stats.stats.played += 1;

  saveStats();
  saveDaily();
  renderFooterState();
  window.setTimeout(showStats, 3500);
}

function revealAnswers(): void {
  if (daily.gameStatus !== 'lost') return;
  for (let i = 0; i < 9; i++) {
    if (daily.footballers[i]) continue;
    const cands = cellCandidates(puzzle!.columns, puzzle!.rows, i, usedIds());
    if (cands.length === 0) continue;
    cands.sort((a, b) => (player(b)?.image ? 1 : 0) - (player(a)?.image ? 1 : 0));
    place(i, cands[0], true);
  }
  saveDaily();
  renderFooterState();
  setMessage('Answers revealed.');
}

// --- setup / new grid ------------------------------------------------------
function buildPuzzle(level: Level, seed: number): Puzzle | null {
  let built = generateGrid(categories, level, seed);
  for (let attempt = 1; !built && attempt <= 6; attempt++) {
    built = generateGrid(categories, level, (seed + attempt * 7919) >>> 0);
  }
  return built;
}

function startGame(): void {
  const built = buildPuzzle(daily.level, hashString(`grid:${todaySeed()}:${daily.level}`));
  if (!built) {
    setMessage('Could not build a grid — try another mode.', 'lose');
    return;
  }
  puzzle = built;
  daily.columnIds = built.columns.map((c) => c.id);
  daily.rowIds = built.rows.map((c) => c.id);
  daily.footballers = new Array(9).fill(null);
  daily.help = [];
  daily.gameStatus = 'playing';
  daily.isDaily = true;
  saveDaily();

  if (daily.timerMode !== 'no timer') {
    remaining = Number(daily.timerMode);
    saveTimer();
    startTimer();
  }
  setMessage('');
  renderGame();
  guessEl.focus();
}

function newGrid(): void {
  const built = buildPuzzle(daily.level, randomSeed());
  if (!built) return;
  puzzle = built;
  daily.columnIds = built.columns.map((c) => c.id);
  daily.rowIds = built.rows.map((c) => c.id);
  daily.footballers = new Array(9).fill(null);
  daily.help = [];
  daily.gameStatus = 'playing';
  daily.isDaily = false;
  saveDaily();
  if (daily.timerMode !== 'no timer') {
    remaining = Number(daily.timerMode);
    saveTimer();
    startTimer();
  } else {
    stopTimer();
  }
  setMessage('');
  renderGame();
  guessEl.focus();
  guessEl.select();
}

// --- timer -----------------------------------------------------------------
function startTimer(): void {
  stopTimer();
  if (daily.timerMode === 'no timer') return;
  if (remaining <= 0) remaining = Number(daily.timerMode);
  timerId = window.setInterval(() => {
    remaining -= 1;
    saveTimer();
    updateTimer();
    if (remaining <= 0) {
      const filled = daily.footballers.filter(Boolean).length;
      if (filled < 9) endGame('lost');
      else stopTimer();
    }
  }, 1000);
  updateTimer();
}

function stopTimer(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function updateTimer(): void {
  const el = document.getElementById('box-timer');
  if (!el) return;
  el.textContent = String(Math.max(0, remaining));
  el.classList.toggle('t-red', remaining < 20);
  el.classList.toggle('t-orange', remaining >= 20 && remaining < 40);
}

// --- search ----------------------------------------------------------------
function buildSearchCache(): void {
  searchCache = index.players.map((p) => ({
    p,
    name: normalizeName(p.name),
    last: normalizeName(lastName(p.name)),
  }));
}

function searchPlayers(query: string): Player[] {
  const matches: Player[] = [];
  for (const entry of searchCache) {
    if (entry.name.startsWith(query) || entry.last.startsWith(query)) matches.push(entry.p);
  }
  matches.sort((a, b) => {
    const exact = (p: Player) => {
      const n = normalizeName(p.name);
      return n === query || normalizeName(lastName(p.name)) === query ? 0 : 1;
    };
    return exact(a) - exact(b);
  });
  return matches.slice(0, 20);
}

function clearSuggestions(): void {
  suggestions = [];
  suggestionsEl.hidden = true;
  suggestionsEl.innerHTML = '';
}

function renderSuggestions(list: Player[]): void {
  suggestions = list;
  suggestionIndex = 0;
  suggestionsEl.innerHTML = '';
  if (!list.length) {
    suggestionsEl.hidden = true;
    return;
  }
  list.forEach((p, i) => {
    const li = document.createElement('li');
    if (i === suggestionIndex) li.className = 'chosen';
    const first = firstName(p.name);
    const last = lastName(p.name);
    li.innerHTML = `${first ? `${escapeHtml(first)} ` : ''}<span class="bold">${escapeHtml(last)}</span>`;
    li.addEventListener('mouseover', () => {
      suggestionIndex = i;
      [...suggestionsEl.children].forEach((c, ci) => c.classList.toggle('chosen', ci === i));
    });
    li.addEventListener('click', () => {
      guessEl.value = '';
      submitFootballer(p.id);
    });
    suggestionsEl.append(li);
  });
  suggestionsEl.hidden = false;
}

function onGuessInput(): void {
  const q = normalizeName(guessEl.value);
  if (q.length < 3) {
    clearSuggestions();
    return;
  }
  renderSuggestions(searchPlayers(q));
}

function onGuessKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!suggestions.length) return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    suggestionIndex = (suggestionIndex + dir + suggestions.length) % suggestions.length;
    [...suggestionsEl.children].forEach((c, ci) =>
      c.classList.toggle('chosen', ci === suggestionIndex),
    );
    return;
  }
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const value = guessEl.value.trim();
  if (!value) return;
  const chosen = suggestions[suggestionIndex];
  guessEl.value = '';
  submitFootballer(chosen ? chosen.id : null);
}

// --- stats modal -----------------------------------------------------------
function showStats(): void {
  const s = stats.stats;
  const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  const max = Math.max(...stats.distribution, 1);
  const bars = stats.distribution
    .map((count, i) => {
      const height = count > 0 ? Math.round((count / max) * 100) : 0;
      return `<div class="bar"><div class="col" style="height:${height}%"></div><span class="n">${i}</span></div>`;
    })
    .join('');
  statsContent.innerHTML = `
    <button class="modalClose" id="stats-x" type="button">✕</button>
    <h2>Stats</h2>
    <div class="statsGrid">
      <div class="statSection"><h3>${s.played}</h3><p>Played</p></div>
      <div class="statSection"><h3>${s.wins}</h3><p>Wins</p></div>
      <div class="statSection"><h3>${rate}</h3><p>%</p></div>
      <div class="statSection"><h3>${s.currentStreak}</h3><p>Streak</p></div>
      <div class="statSection"><h3>${s.maxStreak}</h3><p>Max Streak</p></div>
    </div>
    <div class="dist">${bars}</div>
  `;
  statsOverlay.hidden = false;
  document.getElementById('stats-x')?.addEventListener('click', () => {
    statsOverlay.hidden = true;
  });
}

// --- boot ------------------------------------------------------------------
function restoreGame(): boolean {
  const columns = daily.columnIds.map((id) => catById.get(id)).filter(Boolean) as GridCategory[];
  const rows = daily.rowIds.map((id) => catById.get(id)).filter(Boolean) as GridCategory[];
  if (columns.length !== 3 || rows.length !== 3) return false;
  puzzle = { columns, rows };
  return true;
}

async function boot(): Promise<void> {
  try {
    index = buildIndex(await loadData());
  } catch {
    setMessage('Could not load player data.', 'lose');
    startScreen.hidden = false;
    return;
  }
  categories = buildCategories(index);
  categories.forEach((c) => catById.set(c.id, c));
  buildSearchCache();
  stats = loadStats();
  daily = loadDaily();

  startButton.addEventListener('click', startGame);
  revealBtn.addEventListener('click', revealAnswers);
  newGridBtn.addEventListener('click', newGrid);
  guessEl.addEventListener('input', onGuessInput);
  guessEl.addEventListener('keydown', onGuessKey);
  statsButton.addEventListener('click', showStats);
  giveUpBtn.addEventListener('click', () => (giveupOverlay.hidden = false));
  document.getElementById('giveup-no')?.addEventListener('click', () => (giveupOverlay.hidden = true));
  document.getElementById('giveup-x')?.addEventListener('click', () => (giveupOverlay.hidden = true));
  document.getElementById('giveup-yes')?.addEventListener('click', () => {
    giveupOverlay.hidden = true;
    endGame('lost');
  });
  document.addEventListener('click', (e) => {
    if (!suggestionsEl.contains(e.target as Node) && e.target !== guessEl) clearSuggestions();
  });

  if (daily.gameStatus === 'not started') {
    renderStart();
    return;
  }

  if (!restoreGame()) {
    daily = defaultDaily();
    saveDaily();
    renderStart();
    return;
  }

  renderGame();
  if (daily.gameStatus === 'playing') {
    if (daily.timerMode !== 'no timer') {
      remaining = loadTimer();
      if (remaining <= 0) endGame('lost');
      else startTimer();
    }
  } else if (daily.gameStatus === 'won') {
    setMessage('Congratulations, you won.', 'win');
  } else {
    setMessage('Sorry, you lost today.', 'lose');
  }
}

boot();
