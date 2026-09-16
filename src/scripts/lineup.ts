// Game 1 — The XI, rebuilt in the form of futbol11.com/futbol11-clubs:
// 11 clubs appear in random order and you add a *current* player from each into
// one of the formation's positions. Daily seeded, Easy/Normal, timers, white
// flag, stats, plus a "New game" button for unlimited play.
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
import { jerseySvg } from './club-style';
import {
  SLOT_LABELS,
  canCompleteLineup,
  eligibleClubs,
  formationByName,
  generateLineup,
  laneX,
  slotsForPositions,
  type Formation,
  type LineupPuzzle,
} from './lineup-model';

const K_DAILY = 'matchday:lineup2:daily';
const K_STATS = 'matchday:lineup2:stats';
const K_TIMER = 'matchday:lineup2:timer';

type Mode = 'easy' | 'normal';
type TimerOption = 'no timer' | '90' | '60' | '40';
type GameStatus = 'not started' | 'playing' | 'won' | 'lost';

interface Slot {
  position: string;
  playerId: string | null;
  option?: boolean;
  help?: boolean;
}

interface DailyState {
  day: string;
  mode: Mode;
  timerMode: TimerOption;
  gameStatus: GameStatus;
  formation: string;
  clubOrder: string[];
  lineup: Slot[];
  isDaily: boolean;
}

interface StatsData {
  stats: { played: number; wins: number; currentStreak: number; maxStreak: number };
  distribution: number[];
}

const TIMERS: { value: TimerOption; label: string }[] = [
  { value: 'no timer', label: 'No timer' },
  { value: '90', label: '90s' },
  { value: '60', label: '60s' },
  { value: '40', label: '40s' },
];

// --- DOM -------------------------------------------------------------------
const startScreen = document.getElementById('start-screen') as HTMLDivElement;
const gameScreen = document.getElementById('game-screen') as HTMLDivElement;
const modeLabels = document.getElementById('mode-labels') as HTMLDivElement;
const timerLabels = document.getElementById('timer-labels') as HTMLDivElement;
const startButton = document.getElementById('start-button') as HTMLButtonElement;
const teamCard = document.getElementById('team-card') as HTMLDivElement;
const timerCircle = document.getElementById('timer-circle') as HTMLDivElement;
const pitchEl = document.getElementById('pitch') as HTMLDivElement;
const guessEl = document.getElementById('guess') as HTMLInputElement;
const suggestionsEl = document.getElementById('suggestions') as HTMLUListElement;
const messageEl = document.getElementById('message') as HTMLParagraphElement;
const giveUpBtn = document.getElementById('give-up') as HTMLButtonElement;
const revealBtn = document.getElementById('reveal') as HTMLButtonElement;
const newGameBtn = document.getElementById('new-game') as HTMLButtonElement;
const statsButton = document.getElementById('stats-button') as HTMLButtonElement;
const statsOverlay = document.getElementById('stats-overlay') as HTMLDivElement;
const statsContent = document.getElementById('stats-content') as HTMLDivElement;
const giveupOverlay = document.getElementById('giveup-overlay') as HTMLDivElement;

// --- state -----------------------------------------------------------------
let index: Index;
let squads = new Map<string, string[]>();
let clubPool: string[] = [];
let puzzle: LineupPuzzle | null = null;
let formation: Formation;
let daily: DailyState = defaultDaily();
let stats: StatsData = defaultStats();
let remaining = 90;
let timerId: number | null = null;
let pendingPlayer: string | null = null;
let suggestionIndex = 0;
let suggestions: Player[] = [];
let searchCache: { p: Player; name: string; last: string }[] = [];

function defaultDaily(): DailyState {
  return {
    day: todaySeed(),
    mode: 'normal',
    timerMode: 'no timer',
    gameStatus: 'not started',
    formation: '433',
    clubOrder: [],
    lineup: [],
    isDaily: true,
  };
}

function defaultStats(): StatsData {
  return {
    stats: { played: 0, wins: 0, currentStreak: 0, maxStreak: 0 },
    distribution: new Array(12).fill(0),
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

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
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
      if (saved.day === todaySeed()) return { ...defaultDaily(), ...saved };
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
function saveTimer(): void {
  localStorage.setItem(K_TIMER, String(remaining));
}
function loadTimer(): number {
  const v = Number(localStorage.getItem(K_TIMER));
  return Number.isFinite(v) && v > 0 ? v : 90;
}

// --- start screen ----------------------------------------------------------
function renderStart(): void {
  startScreen.hidden = false;
  gameScreen.hidden = true;
  statsButton.hidden = true;

  modeLabels.innerHTML = '';
  (['easy', 'normal'] as Mode[]).forEach((mode) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `generalLabel${daily.mode === mode ? ' activeLabel' : ''}`;
    btn.textContent = mode === 'easy' ? 'Easy' : 'Normal';
    btn.addEventListener('click', () => {
      daily.mode = mode;
      saveDaily();
      renderStart();
    });
    modeLabels.append(btn);
  });

  timerLabels.innerHTML = '';
  TIMERS.forEach((t) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `generalLabel${daily.timerMode === t.value ? ' activeLabel' : ''}`;
    btn.textContent = t.label;
    btn.addEventListener('click', () => {
      daily.timerMode = t.value;
      saveDaily();
      renderStart();
    });
    timerLabels.append(btn);
  });
}

// --- puzzle ----------------------------------------------------------------
function buildPuzzle(mode: Mode, seed: number): LineupPuzzle | null {
  return generateLineup(clubPool, squads, index, seed, mode === 'easy');
}

function applyPuzzle(p: LineupPuzzle, clubOrder: string[]): void {
  puzzle = p;
  formation = p.formation;
  daily.formation = p.formation.name;
  daily.clubOrder = clubOrder;
  daily.lineup = p.formation.slots.map((position) => ({ position, playerId: null }));
}

function startGame(): void {
  const seed = hashString(`lineup:${todaySeed()}:${daily.mode}`);
  const built = buildPuzzle(daily.mode, seed);
  if (!built) {
    setMessage('Could not build a lineup — try another mode.', 'lose');
    return;
  }
  applyPuzzle(built, built.teams.map((t) => t.club));
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

function newGame(): void {
  const built = buildPuzzle(daily.mode, randomSeed());
  if (!built) return;
  applyPuzzle(built, built.teams.map((t) => t.club));
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
}

// --- rendering -------------------------------------------------------------
function renderGame(): void {
  startScreen.hidden = true;
  gameScreen.hidden = false;
  statsButton.hidden = false;
  if (!puzzle) return;
  timerCircle.hidden = daily.timerMode === 'no timer';
  renderTeamCard();
  renderPitch();
  renderFooterState();
  updateTimer();
}

function renderTeamCard(): void {
  teamCard.innerHTML = '';
  const team = puzzle!.teams[0];
  if (!team) {
    teamCard.classList.add('done');
    const p = document.createElement('p');
    p.textContent = 'Lineup complete';
    teamCard.append(p);
    return;
  }
  teamCard.classList.remove('done');
  const jersey = document.createElement('div');
  jersey.className = 'teamJersey';
  jersey.innerHTML = jerseySvg(team.club, `team-${team.club}`);
  const info = document.createElement('div');
  info.className = 'teamInfo';
  const title = document.createElement('p');
  title.className = 'teamName';
  title.textContent = team.club;
  const sub = document.createElement('p');
  sub.className = 'teamSub';
  sub.textContent = `${puzzle!.teams.length} club${puzzle!.teams.length === 1 ? '' : 's'} left`;
  info.append(title, sub);
  teamCard.append(jersey, info);
}

function renderPitch(): void {
  pitchEl.innerHTML = '';
  formation.bands.forEach((band) => {
    const row = document.createElement('div');
    row.className = 'pitchRow';
    const positions = band.map((i) => daily.lineup[i].position);
    band.forEach((i, slotInRow) => {
      const slot = daily.lineup[i];
      const card = document.createElement('div');
      card.className = 'slotCard';
      card.style.setProperty('--x', `${laneX(positions, slotInRow)}%`);
      card.dataset.i = String(i);
      card.addEventListener('click', () => chooseSlot(i));

      const circle = document.createElement('div');
      circle.className = 'slotCircle';
      if (slot.playerId) {
        const p = player(slot.playerId);
        circle.classList.add('filled');
        if (slot.help) circle.classList.add('help');
        if (p?.image) {
          const img = document.createElement('img');
          img.src = p.image;
          img.alt = p.name;
          img.loading = 'lazy';
          circle.append(img);
        } else if (p) {
          const span = document.createElement('span');
          span.className = 'slotInitials';
          span.textContent = initials(p.name);
          circle.append(span);
        }
      } else if (slot.option) {
        circle.classList.add('option');
        circle.textContent = slot.position;
      } else {
        circle.classList.add('empty');
        circle.textContent = slot.position;
      }

      const label = document.createElement('p');
      label.className = 'slotLabel';
      label.textContent = slot.playerId ? lastName(player(slot.playerId)?.name ?? '') : '';

      card.append(circle, label);
      row.append(card);
    });
    pitchEl.append(row);
  });
}

function renderFooterState(): void {
  const playing = daily.gameStatus === 'playing';
  guessEl.disabled = !playing;
  giveUpBtn.disabled = !playing;
  const filled = daily.lineup.filter((s) => s.playerId).length;
  revealBtn.hidden = !(daily.gameStatus === 'lost' && filled < 11);
  newGameBtn.textContent = playing ? 'New game' : 'Play again';
}

// --- playing ---------------------------------------------------------------
function placementOk(slotIndex: number): boolean {
  const openAfter = new Set<number>();
  daily.lineup.forEach((s, i) => {
    if (!s.playerId && i !== slotIndex) openAfter.add(i);
  });
  return canCompleteLineup(puzzle!.teams.slice(1), formation, openAfter, index);
}

function clearOptions(): void {
  daily.lineup.forEach((s) => delete s.option);
  pendingPlayer = null;
}

function place(slotIndex: number, playerId: string, help = false): void {
  const slot = daily.lineup[slotIndex];
  slot.playerId = playerId;
  slot.help = help;
  delete slot.option;
  pendingPlayer = null;
  daily.lineup.forEach((s) => delete s.option);
  puzzle!.teams.shift();
  renderTeamCard();
  renderPitch();
  renderFooterState();
  saveDaily();
}

function chooseSlot(i: number): void {
  const slot = daily.lineup[i];
  if (!slot.option || !pendingPlayer) return;
  const id = pendingPlayer;
  place(i, id);
  setMessage(`${lastName(player(id)!.name)} added as ${SLOT_LABELS[slot.position]}`);
  checkWin();
}

function submitPlayer(id: string | null): void {
  if (daily.gameStatus !== 'playing') return;
  clearOptions();
  clearSuggestions();
  renderPitch();
  const team = puzzle!.teams[0];
  if (!team) return;

  if (!id) {
    setMessage("Can't find that footballer");
    return;
  }
  const p = player(id);
  if (!p) return;

  if (!team.squad.includes(id)) {
    setMessage(`${lastName(p.name)} doesn't play for ${team.club}`);
    return;
  }

  const slots = slotsForPositions(p.positions);
  const matching = daily.lineup
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.playerId && slots.has(s.position));

  if (matching.length === 0) {
    setMessage(`${lastName(p.name)} has no open position in this formation`);
    return;
  }

  const viable = matching.filter(({ i }) => placementOk(i));
  if (viable.length === 0) {
    setMessage(`That would make the rest of the lineup impossible to complete`);
    return;
  }
  if (viable.length === 1) {
    const pos = daily.lineup[viable[0].i].position;
    place(viable[0].i, id);
    setMessage(`${lastName(p.name)} added as ${SLOT_LABELS[pos]}`);
    checkWin();
    return;
  }

  pendingPlayer = id;
  viable.forEach(({ i }) => {
    daily.lineup[i].option = true;
  });
  renderPitch();
  setMessage(`Choose a position for ${lastName(p.name)}`);
}

function checkWin(): void {
  if (puzzle!.teams.length === 0) endGame('won');
}

function endGame(result: 'won' | 'lost'): void {
  if (daily.gameStatus !== 'playing') return;
  daily.gameStatus = result;
  stopTimer();

  const placed = daily.lineup.filter((s) => s.playerId).length;
  stats.distribution[placed] = (stats.distribution[placed] ?? 0) + 1;
  if (result === 'won') {
    stats.stats.wins += 1;
    if (daily.isDaily) {
      stats.stats.currentStreak += 1;
      stats.stats.maxStreak = Math.max(stats.stats.maxStreak, stats.stats.currentStreak);
    }
    setMessage('Full time! You completed your XI.', 'win');
  } else {
    if (daily.isDaily) stats.stats.currentStreak = 0;
    setMessage('Sorry, you lost.', 'lose');
  }
  stats.stats.played += 1;
  saveStats();
  saveDaily();
  renderFooterState();
  window.setTimeout(showStats, 3000);
}

function revealAnswers(): void {
  if (daily.gameStatus !== 'lost') return;
  const teams = [...puzzle!.teams];
  for (let t = 0; t < teams.length; t++) {
    const team = teams[t];
    let done = false;
    for (const pid of team.squad) {
      const p = player(pid);
      if (!p) continue;
      const slots = slotsForPositions(p.positions);
      for (let i = 0; i < daily.lineup.length; i++) {
        const slot = daily.lineup[i];
        if (slot.playerId || !slots.has(slot.position)) continue;
        const openAfter = new Set<number>();
        daily.lineup.forEach((s, j) => {
          if (!s.playerId && j !== i) openAfter.add(j);
        });
        if (canCompleteLineup(teams.slice(t + 1), formation, openAfter, index)) {
          daily.lineup[i].playerId = pid;
          daily.lineup[i].help = true;
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }
  puzzle!.teams = [];
  renderTeamCard();
  renderPitch();
  renderFooterState();
  saveDaily();
  setMessage('Answers revealed.');
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
      if (daily.lineup.some((s) => !s.playerId)) endGame('lost');
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
    li.innerHTML = `${first ? `${escapeHtml(first)} ` : ''}<span class="bold">${escapeHtml(lastName(p.name))}</span>`;
    li.addEventListener('mouseover', () => {
      suggestionIndex = i;
      [...suggestionsEl.children].forEach((c, ci) => c.classList.toggle('chosen', ci === i));
    });
    li.addEventListener('click', () => {
      guessEl.value = '';
      submitPlayer(p.id);
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
  submitPlayer(chosen ? chosen.id : null);
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
async function loadSquads(): Promise<Map<string, string[]>> {
  const res = await fetch('/data/current-clubs.json');
  if (!res.ok) throw new Error(`current-clubs.json ${res.status}`);
  const data = (await res.json()) as { players: Record<string, string[]> };
  const map = new Map<string, string[]>();
  for (const [id, clubs] of Object.entries(data.players)) {
    for (const club of clubs) {
      if (!map.has(club)) map.set(club, []);
      map.get(club)!.push(id);
    }
  }
  return map;
}

function restoreGame(): boolean {
  if (!daily.lineup.length) return false;
  formation = formationByName(daily.formation);
  const teams = daily.clubOrder
    .filter((club) => squads.has(club))
    .map((club) => ({ club, squad: squads.get(club)! }));
  // drop clubs that already have a filled slot? club order wasn't consumed on
  // reload, so rebuild by removing one club per placed slot from the front.
  const placedCount = daily.lineup.filter((s) => s.playerId).length;
  const remainingTeams = teams.slice(placedCount);
  if (daily.gameStatus === 'playing' && remainingTeams.length + placedCount !== 11) {
    return false;
  }
  puzzle = { formation, teams: remainingTeams };
  return true;
}

async function boot(): Promise<void> {
  try {
    index = buildIndex(await loadData());
    squads = await loadSquads();
  } catch {
    setMessage('Could not load player data.', 'lose');
    startScreen.hidden = false;
    return;
  }
  clubPool = eligibleClubs(squads);
  buildSearchCache();
  stats = loadStats();
  daily = loadDaily();

  startButton.addEventListener('click', startGame);
  newGameBtn.addEventListener('click', newGame);
  revealBtn.addEventListener('click', revealAnswers);
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
    setMessage('Full time! You completed your XI.', 'win');
  } else {
    setMessage('Sorry, you lost.', 'lose');
  }
}

boot();
