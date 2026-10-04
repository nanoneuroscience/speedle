const view = document.querySelector('#view');
const toast = document.querySelector('#toast');
const params = new URLSearchParams(location.search);
let inviteRoomCode = (params.get('room') || '').toUpperCase().slice(0, 4);
let playerId = localStorage.getItem('speedrun-player');
let roomCode = localStorage.getItem('speedrun-room');
let state = null;
let eventSource = null;
let clockTicker = null;
let selectedTab = inviteRoomCode ? 'join' : 'create';
let toastTimer;
let localGuess = null;
let guessRound = null;
let guessRunnerProgress = 0;
let actualRunnerProgress = 0;
let guessRunnerRate = 0;
let actualRunnerRate = 0;
let runnerLastFrame = 0;
let runnerLoopStarted = false;
let animationRevealRound = null;
const healthLevels = new Map();
let dailyDeckStatus = 'idle';
let dailyChallenge = null;
let dailyGuess = null;
let dailyUnitSystem = localStorage.getItem('speedle-daily-units') === 'metric' ? 'metric' : 'imperial';
let dailyResult = null;
let dailyMidnightTimer = null;
let dailyError = '';
let dailyCommunityStats = null;
let dailyCommunityStatus = 'idle';
let dailyCommunityError = '';
let dailyCommunityRequestId = 0;
const questionVisuals = {
  'Peregrine falcon': { icon: '🦅', speed: 240 }, 'Cheetah': { icon: '🐆', speed: 70 },
  'Sailfish': { icon: '🐟', speed: 68 }, 'Ostrich': { icon: '🦤', speed: 43 },
  'House cat': { icon: '🐈', speed: 30 }, 'Usain Bolt': { icon: '🏃', speed: 28 },
  'Road bicycle': { icon: '🚴', speed: 60 }, 'Formula 1 car': { icon: '🏎️', speed: 230 },
  'Boeing 747': { icon: '✈️', speed: 614 }, 'Blue whale': { icon: '🐋', speed: 31 },
  'Greyhound': { icon: '🐕', speed: 45 }, 'Bullet train': { icon: '🚄', speed: 200 },
};
const leftFacingIcons = new Set([
  '🦅', '🐆', '🐟', '🦤', '🐈', '🐋', '🐕', '🦌', '🐅', '🐘', '🦒', '🐎', '🐪',
  '🦘', '🦬', '🦓', '🫎', '🐺', '🐻‍❄️', '🐇', '🦛', '🦏', '🐒', '🐦', '🦆',
  '🕊️', '🦈', '🐬', '🦭', '🐧', '🏎️', '🚘', '🚙', '🚄', '🏍️', '🚤', '🛥️',
]);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const currentPlayer = () => state?.players.find(p => p.id === playerId);
const isHost = () => state?.hostId === playerId;
const KMH_PER_MPH = 1.609344;
function unitShort(unitSystem = state?.unitSystem) { return unitSystem === 'metric' ? 'km/h' : 'mph'; }
function unitLabel(unitSystem = state?.unitSystem) { return unitSystem === 'metric' ? 'KM/H' : 'MPH'; }
function displaySpeed(mph, unitSystem = state?.unitSystem) { return unitSystem === 'metric' ? Math.round(mph * KMH_PER_MPH) : Math.round(mph); }
function displayRange(question, unitSystem = state?.unitSystem) { return displaySpeed(question.range, unitSystem); }
function displaySpeedNote(note, unitSystem = state?.unitSystem) {
  return String(note ?? '').replace(/(\d[\d,]*(?:\.\d+)?)\s*mph\b/gi, (_, value) => `${displaySpeed(Number(value.replaceAll(',', '')), unitSystem)} ${unitShort(unitSystem)}`);
}
function dailyRange() { return dailyChallenge ? displayRange(dailyChallenge.question, dailyUnitSystem) : 0; }
function dailyResultKey(day) { return `speedle-daily-result-${day}`; }
function dailyParticipantId(day) {
  const key = `speedle-daily-participant-${day}`;
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
function scheduleDailyRefresh(serverTime) {
  clearTimeout(dailyMidnightTimer);
  const nextUtcMidnight = Date.UTC(serverTime.getUTCFullYear(), serverTime.getUTCMonth(), serverTime.getUTCDate() + 1);
  dailyMidnightTimer = setTimeout(() => {
    dailyCommunityRequestId += 1;
    dailyDeckStatus = 'idle'; dailyChallenge = null; dailyGuess = null; dailyResult = null;
    dailyCommunityStats = null; dailyCommunityStatus = 'idle'; dailyCommunityError = '';
    guessRunnerRate = 0; actualRunnerRate = 0; guessRunnerProgress = 0; actualRunnerProgress = 0;
    if (!state) { renderDailyCard(); loadDailyChallenge(); }
  }, Math.max(1000, nextUtcMidnight - serverTime.getTime() + 1200));
}
async function loadDailyChallenge() {
  if (dailyDeckStatus === 'loading' || dailyDeckStatus === 'ready' || dailyDeckStatus === 'error') return;
  dailyCommunityRequestId += 1;
  dailyDeckStatus = 'loading';
  dailyError = '';
  dailyCommunityStats = null; dailyCommunityStatus = 'idle'; dailyCommunityError = '';
  try {
    const response = await fetch('/daily-deck.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load today’s challenge.');
    const deck = await response.json();
    if (!Array.isArray(deck) || !deck.length) throw new Error('The daily question deck is empty.');
    const serverTime = new Date(response.headers.get('date') || Date.now());
    const effectiveTime = Number.isNaN(serverTime.getTime()) ? new Date() : serverTime;
    const day = effectiveTime.toISOString().slice(0, 10);
    const dayNumber = Math.floor(Date.UTC(effectiveTime.getUTCFullYear(), effectiveTime.getUTCMonth(), effectiveTime.getUTCDate()) / 86400000);
    const question = deck[((dayNumber % deck.length) + deck.length) % deck.length];
    dailyChallenge = { day, question };
    dailyDeckStatus = 'ready';
    const saved = localStorage.getItem(dailyResultKey(day));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.question === question.name) {
          dailyResult = parsed;
          dailyUnitSystem = parsed.unitSystem === 'metric' ? 'metric' : 'imperial';
          dailyGuess = displaySpeed(parsed.guess, dailyUnitSystem);
        }
      } catch { localStorage.removeItem(dailyResultKey(day)); }
    }
    if (dailyResult) {
      guessRunnerRate = speedToRunnerRate(dailyResult.guess, question.range);
      actualRunnerRate = speedToRunnerRate(question.speed, question.range);
    } else {
      if (dailyGuess == null) dailyGuess = Math.round(dailyRange() / 2);
      guessRunnerRate = speedToRunnerRate(dailyGuess, dailyRange());
      actualRunnerRate = 0;
    }
    scheduleDailyRefresh(effectiveTime);
  } catch (error) {
    dailyDeckStatus = 'error';
    dailyChallenge = null;
    dailyError = error.message;
  }
  if (!state) renderDailyCard();
  if (!state && dailyResult) void refreshDailyCommunity(true);
}
async function refreshDailyCommunity(saveScore = false) {
  if (!dailyChallenge || !dailyResult) return;
  const requestId = ++dailyCommunityRequestId;
  const { day } = dailyChallenge;
  const participantId = dailyParticipantId(day);
  dailyCommunityStatus = 'loading';
  dailyCommunityError = '';
  if (!state) renderDailyCard();
  try {
    if (saveScore) {
      const submission = await fetch('/api/daily-scores', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, participantId, guess: dailyResult.guess }),
      });
      const submissionData = await submission.json();
      if (!submission.ok) throw new Error(submissionData.error || 'Could not submit today’s score.');
    }
    const query = new URLSearchParams({ day, participant: participantId });
    const response = await fetch(`/api/daily-scores?${query}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load today’s scores.');
    if (requestId !== dailyCommunityRequestId) return;
    dailyCommunityStats = data;
    dailyCommunityStatus = 'ready';
  } catch (error) {
    if (requestId !== dailyCommunityRequestId) return;
    dailyCommunityError = error.message;
    dailyCommunityStatus = 'error';
  }
  if (!state) renderDailyCard();
}
function dailyCommunityPanel() {
  const header = `<div class="daily-community-head"><div><div class="eyebrow">TODAY’S COMMUNITY</div><h3>How others scored</h3></div><button class="community-refresh" id="daily-community-refresh" type="button" aria-label="Refresh community scores" title="Refresh scores" ${dailyCommunityStatus === 'loading' ? 'disabled' : ''}>↻</button></div>`;
  if (dailyCommunityStatus === 'loading' || dailyCommunityStatus === 'idle') return `<section class="daily-community" aria-live="polite">${header}<div class="community-message"><span class="spinner"></span> Adding your anonymous score…</div></section>`;
  if (dailyCommunityStatus === 'error') return `<section class="daily-community" aria-live="polite">${header}<div class="community-message"><span>${escapeHtml(dailyCommunityError || 'Could not load community scores.')}</span><button class="btn community-retry" id="daily-community-retry" type="button">Try again</button></div></section>`;
  const stats = dailyCommunityStats;
  if (!stats || stats.playerCount === 0) return `<section class="daily-community" aria-live="polite">${header}<div class="community-message">You’re the first today. Your score will appear in the curve other players see.</div></section>`;
  const max = Math.max(1, ...stats.buckets);
  const userBucket = Math.min(9, Math.floor(stats.myAccuracy / 10));
  const bars = stats.buckets.map((count, index) => {
    const height = count ? Math.max(5, Math.round(count / max * 100)) : 0;
    const label = index === 9 ? '90–100' : `${index * 10}–${index * 10 + 9}`;
    return `<div class="community-bin ${index === userBucket ? 'is-your-score' : ''}" title="${label}% accuracy: ${count} players"><span class="community-bin-count">${count || ''}</span><div class="community-bar-track"><i style="height:${height}%"></i></div><span class="community-bin-label">${label}</span></div>`;
  }).join('');
  return `<section class="daily-community" aria-live="polite">${header}<div class="community-stats"><div><strong>${stats.playerCount}</strong><span>OTHER PLAYERS</span></div><div><strong>${stats.averageAccuracy}%</strong><span>AVERAGE</span></div><div><strong>${stats.percentile}%</strong><span>BEAT</span></div></div><div class="community-chart" role="img" aria-label="Accuracy distribution for ${stats.playerCount} other players. Your score is ${stats.myAccuracy} percent.">${bars}</div><div class="community-axis-note"><span>ACCURACY SCORE</span><span class="community-your-key"><i></i> YOUR SCORE RANGE</span></div></section>`;
}
function dailyPanel() {
  if (dailyDeckStatus === 'loading' || dailyDeckStatus === 'idle') return `<div class="daily-loading"><span class="spinner"></span> Loading today’s shared challenge…</div>`;
  if (dailyDeckStatus === 'error') return `<div class="daily-loading"><p>${escapeHtml(dailyError || 'Could not load today’s challenge.')}</p><button class="btn btn-primary btn-full" id="daily-retry">Try again</button></div>`;
  const question = dailyChallenge.question;
  const max = dailyRange();
  const value = dailyGuess ?? Math.round(max / 2);
  const result = dailyResult;
  const resultUnit = result?.unitSystem || dailyUnitSystem;
  const resultGuess = result ? displaySpeed(result.guess, resultUnit) : null;
  const shownGuess = result ? resultGuess : value;
  const formattedDate = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dailyChallenge.day}T00:00:00Z`));
  const resultContent = result
    ? `<div class="daily-result"><div class="daily-score"><strong>${result.accuracy}%</strong><span>ACCURACY</span></div><div class="daily-result-values"><div><span>REAL SPEED</span><strong>${displaySpeed(question.speed, resultUnit)} ${unitShort(resultUnit)}</strong></div><div><span>YOUR GUESS</span><strong>${resultGuess} ${unitShort(resultUnit)}</strong></div><div><span>OFF BY</span><strong>${displaySpeed(Math.abs(result.guess - question.speed), resultUnit)} ${unitShort(resultUnit)}</strong></div></div></div>${dailyCommunityPanel()}<div class="hint daily-reset-hint">Come back tomorrow for a new challenge.</div>`
    : `<div class="daily-control-row"><div class="daily-unit-row"><label class="field-label" for="daily-unit-system">SPEED UNITS</label><select class="input daily-unit-select" id="daily-unit-system" aria-label="Daily guess speed units"><option value="imperial" ${dailyUnitSystem === 'imperial' ? 'selected' : ''}>Imperial · MPH</option><option value="metric" ${dailyUnitSystem === 'metric' ? 'selected' : ''}>Metric · KM/H</option></select></div><div class="guess-control daily-guess-control"><div class="guess-top"><label for="daily-guess-slider">SET YOUR GUESSED SPEED</label><div class="guess-number"><span id="daily-guess-readout">${value}</span> <small>${unitLabel(dailyUnitSystem)}</small></div></div><div class="range-wrap"><input class="range" id="daily-guess-slider" type="range" min="0" max="${max}" value="${value}" step="1" style="--progress:${value / max * 100}%" aria-label="Set your daily speed guess in ${dailyUnitSystem === 'metric' ? 'kilometres per hour' : 'miles per hour'}"/></div><div class="range-labels"><span>0 ${unitShort(dailyUnitSystem)}</span><span>${max} ${unitShort(dailyUnitSystem)}</span></div></div><button class="btn btn-primary daily-submit" id="daily-submit">Reveal today’s speed</button></div>`;
  return `<div class="daily-head"><div><h2>Daily Speedle</h2></div><span class="count-tag">${escapeHtml(formattedDate)}</span></div>
    <div class="daily-question-strip"><div><div class="eyebrow">${escapeHtml(question.kind)}</div><h3>${escapeHtml(question.name)}</h3><p>${result ? escapeHtml(displaySpeedNote(question.note, resultUnit)) : 'What’s its top speed?'}</p></div><span class="daily-question-icon" aria-hidden="true">${escapeHtml(question.icon)}</span></div>
    <div class="daily-lanes-wrap">${speedLanes(question, shownGuess, Boolean(result), resultUnit)}</div>${resultContent}`;
}
function renderDailyCard() {
  const content = view.querySelector('#daily-challenge-content');
  if (!content || state) return;
  content.innerHTML = dailyPanel();
  bindDailyCard();
}
function bindDailyCard() {
  view.querySelector('#daily-retry')?.addEventListener('click', () => {
    dailyDeckStatus = 'idle';
    renderDailyCard();
    loadDailyChallenge();
  });
  view.querySelector('#daily-community-refresh')?.addEventListener('click', () => void refreshDailyCommunity(false));
  view.querySelector('#daily-community-retry')?.addEventListener('click', () => void refreshDailyCommunity(true));
  view.querySelector('#daily-unit-system')?.addEventListener('change', event => {
    const oldRange = dailyRange();
    const ratio = oldRange ? Number(dailyGuess) / oldRange : .5;
    dailyUnitSystem = event.currentTarget.value;
    localStorage.setItem('speedle-daily-units', dailyUnitSystem);
    dailyGuess = Math.round(dailyRange() * ratio);
    guessRunnerRate = speedToRunnerRate(dailyGuess, dailyRange());
    renderDailyCard();
  });
  view.querySelector('#daily-guess-slider')?.addEventListener('input', event => {
    dailyGuess = Number(event.currentTarget.value);
    guessRunnerRate = speedToRunnerRate(dailyGuess, dailyRange());
    const readout = view.querySelector('#daily-guess-readout');
    if (readout) readout.textContent = dailyGuess;
    event.currentTarget.style.setProperty('--progress', `${dailyGuess / Number(event.currentTarget.max) * 100}%`);
  });
  view.querySelector('#daily-submit')?.addEventListener('click', () => {
    const question = dailyChallenge.question;
    const canonicalGuess = Number((dailyUnitSystem === 'metric' ? dailyGuess / KMH_PER_MPH : dailyGuess).toFixed(3));
    const damage = Math.min(100, Math.round(100 * Math.abs(canonicalGuess - question.speed) / question.range));
    dailyResult = { question: question.name, guess: canonicalGuess, unitSystem: dailyUnitSystem, accuracy: 100 - damage };
    localStorage.setItem(dailyResultKey(dailyChallenge.day), JSON.stringify(dailyResult));
    guessRunnerProgress = 0;
    actualRunnerProgress = 0;
    guessRunnerRate = speedToRunnerRate(canonicalGuess, question.range);
    actualRunnerRate = speedToRunnerRate(question.speed, question.range);
    renderDailyCard();
    void refreshDailyCommunity(true);
  });
}
function speedToRunnerRate(speed, range) {
  const ratio = range > 0 ? Math.max(0, Math.min(1, speed / range)) : 0;
  return speed <= 0 ? 0 : 0.65 * (0.18 + 1.32 * ratio);
}
function animateRunner(timestamp) {
  if (!runnerLastFrame) runnerLastFrame = timestamp;
  const delta = Math.min((timestamp - runnerLastFrame) / 1000, 0.05);
  runnerLastFrame = timestamp;
  if (guessRunnerRate > 0) guessRunnerProgress = (guessRunnerProgress + delta * guessRunnerRate) % 1;
  if (actualRunnerRate > 0) actualRunnerProgress = (actualRunnerProgress + delta * actualRunnerRate) % 1;
  const guessRunner = view.querySelector('#guess-marker');
  if (guessRunner) guessRunner.style.left = `${guessRunnerProgress * 100}%`;
  const actualRunner = view.querySelector('#answer-marker');
  if (actualRunner) actualRunner.style.left = `${actualRunnerProgress * 100}%`;
  requestAnimationFrame(animateRunner);
}
function startRunnerLoop() {
  if (runnerLoopStarted) return;
  runnerLoopStarted = true;
  requestAnimationFrame(animateRunner);
}
function notify(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2600); }
async function api(action, body = {}) {
  const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function saveSession(id, code) { playerId = id; roomCode = code; localStorage.setItem('speedrun-player', id); localStorage.setItem('speedrun-room', code); }
function receiveState(nextState) {
  if (nextState.phase === 'lobby' && state?.phase === 'finished') {
    guessRound = null;
    localGuess = null;
    guessRunnerProgress = 0;
    actualRunnerProgress = 0;
    guessRunnerRate = 0;
    actualRunnerRate = 0;
    animationRevealRound = null;
  }
  if (nextState.phase === 'guessing' && nextState.round !== guessRound) {
    guessRound = nextState.round;
    animationRevealRound = null;
    localGuess = Math.round(displayRange(nextState.current) / 2);
    guessRunnerProgress = 0;
    actualRunnerProgress = 0;
    guessRunnerRate = speedToRunnerRate(localGuess, displayRange(nextState.current));
    actualRunnerRate = 0;
  }
  if ((nextState.phase === 'reveal' || nextState.phase === 'finished') && animationRevealRound !== nextState.round) {
    animationRevealRound = nextState.round;
    const submittedGuess = nextState.players.find(p => p.id === playerId)?.guess;
    const visual = questionVisuals[nextState.current?.name] || {};
    const actualSpeed = nextState.current?.speed ?? visual.speed;
    guessRunnerProgress = 0;
    actualRunnerProgress = 0;
    guessRunnerRate = submittedGuess == null ? 0 : speedToRunnerRate(submittedGuess, nextState.current.range);
    actualRunnerRate = actualSpeed == null ? 0 : speedToRunnerRate(actualSpeed, nextState.current.range);
  }
  state = nextState;
  render();
}
function connect(code) {
  eventSource?.close();
  eventSource = new EventSource(`/api/events?room=${encodeURIComponent(code)}`);
  eventSource.onmessage = event => receiveState(JSON.parse(event.data));
  eventSource.onerror = () => {};
  api('state', { code }).then(data => receiveState(data.room)).catch(error => { notify(error.message); leaveRoom(); });
}
function leaveRoom() {
  eventSource?.close();
  eventSource = null;
  state = null;
  playerId = null;
  roomCode = null;
  inviteRoomCode = '';
  selectedTab = 'create';
  localStorage.removeItem('speedrun-player');
  localStorage.removeItem('speedrun-room');
  history.replaceState({}, '', '/');
  render();
}
function createLanding() {
  view.innerHTML = `<section class="landing">
    <div class="hero-copy"><div class="eyebrow"><span class="bar"></span> A SPEED GUESSING SHOWDOWN</div><h1>Speedle.</h1>
      <p class="hero-sub">From hummingbirds to jet planes, do you really know how fast they go? Guess. Survive. Outrun the group and win.</p>
      <div class="hero-pitches"><div class="hero-pitch"><span>WITH FRIENDS</span><strong>Challenge your friends</strong><p>Join a room and see who can outlast the group.</p></div><div class="hero-pitch"><span>ON YOUR OWN</span><strong>Train with Daily Speedle</strong><p>Play today’s solo guess and sharpen your speed sense.</p></div></div>
    </div>
    <div class="entry-card"><div class="tabs"><button class="tab ${selectedTab === 'create' ? 'active' : ''}" data-tab="create">Create a room</button><button class="tab ${selectedTab === 'join' ? 'active' : ''}" data-tab="join">Join a room</button></div>
      <form id="entry-form"><div class="form-row"><label class="field-label" for="player-name">YOUR NAME</label><input id="player-name" class="input" placeholder="What should we call you?" maxlength="18" autocomplete="nickname" required /></div>
      <div class="form-row ${selectedTab === 'join' ? '' : 'hidden'}" id="join-field"><label class="field-label" for="room-code-input">ROOM CODE</label><input id="room-code-input" class="input join-code" placeholder="E.G. J7KM" maxlength="4" autocomplete="off" /></div>
      <button class="btn btn-primary btn-full" type="submit">${selectedTab === 'create' ? 'Create a room  ↗' : 'Join the game  →'}</button></form>
      <p class="hint">${selectedTab === 'create' ? 'You’ll get a code to share. Friends can join from any phone on the same Wi-Fi.' : inviteRoomCode ? 'You were invited to a room. Add your name and jump in.' : 'Ask your host for their room code and join the lobby.'}</p>
    </div>
  </section><section class="rules"><div class="rule"><span class="rule-no">01</span><strong>Pick your speed</strong><span>Slide to your best guess of the object’s top speed.</span></div><div class="rule"><span class="rule-no">02</span><strong>Protect your health</strong><span>Miss by more, lose more. Damage is capped at 100 HP each round.</span></div><div class="rule"><span class="rule-no">03</span><strong>Stay in the race</strong><span>Hit zero and you’re out. Last one standing wins.</span></div></section>
  <section class="daily-section"><div class="daily-game-panel panel"><div id="daily-challenge-content">${dailyPanel()}</div></div></section>`;
  const roomCodeInput = view.querySelector('#room-code-input');
  if (inviteRoomCode && roomCodeInput) roomCodeInput.value = inviteRoomCode;
  view.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    selectedTab = button.dataset.tab;
    // Keep the invite code available if they switch back, but let the selected tab
    // survive a reload instead of reapplying the invite link's join default.
    history.replaceState({}, '', selectedTab === 'join' && inviteRoomCode ? `/?room=${inviteRoomCode}` : '/');
    createLanding();
  }));
  view.querySelector('#entry-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const name = view.querySelector('#player-name').value.trim();
    try {
      const result = selectedTab === 'create' ? await api('create', { name }) : await api('join', { name, code: view.querySelector('#room-code-input').value.trim().toUpperCase() });
      saveSession(result.playerId, result.room.code); receiveState(result.room); connect(result.room.code); history.replaceState({}, '', `/?room=${result.room.code}`);
    } catch (error) { notify(error.message); }
  });
  renderDailyCard();
  loadDailyChallenge();
}
function healthList(players) {
  const heartPath = 'M50 88C46 84 8 60 8 34C8 18 19 8 34 8C42 8 48 12 50 20C52 12 58 8 66 8C81 8 92 18 92 34C92 60 54 84 50 88Z';
  const maxHealth = state?.startingHealth || 200;
  return `<div class="health-list">${players.map(p => {
    const percent = Math.max(0, Math.min(100, p.health / maxHealth * 100));
    const healthRatio = Math.max(0, Math.min(1, p.health / maxHealth));
    const beatDuration = (3.6 - healthRatio * 2.3).toFixed(2);
    const beatPeak = (1.025 + (1 - healthRatio) * 0.095).toFixed(3);
    const beatEcho = (1.012 + (1 - healthRatio) * 0.045).toFixed(3);
    const previous = healthLevels.get(p.id) ?? percent;
    const startingPercent = Math.max(percent, previous);
    healthLevels.set(p.id, percent);
    return `<div class="health-row ${p.alive ? '' : 'dead'}">
      <div class="health-ident"><svg class="health-heart" viewBox="0 0 100 100" role="img" aria-label="${p.health} health points remaining" style="--beat-duration:${beatDuration}s;--beat-peak:${beatPeak};--beat-echo:${beatEcho}"><path class="heart-empty" d="${heartPath}"/><path class="heart-fill" d="${heartPath}" style="--heart-color:${healthRatio <= .2 ? '#c9554c' : '#e66b5b'};clip-path:inset(${100 - startingPercent}% 0 0 0)" data-fill="${percent}"/><path class="heart-outline" d="${heartPath}"/></svg><div class="health-copy"><div class="health-name">${escapeHtml(p.name)}${p.id === playerId ? ' <span style="color:#98a09c;font-weight:400">(you)</span>' : ''}</div><div class="health-caption">${p.alive ? `${Math.round(percent)}% HEALTH` : 'ELIMINATED'}</div></div></div>
      <div class="health-val">${p.health}<small> HP</small></div>
    </div>`;
  }).join('')}</div>`;
}
function lobbySettings() {
  const healthOptions = [[100, 'Short game'], [200, 'Medium game'], [300, 'Long game']];
  const timeOptions = [[15, 'Fast'], [30, 'Standard'], [45, 'Relaxed']];
  const unitOptions = [['imperial', 'Imperial · MPH'], ['metric', 'Metric · KM/H']];
  return `<div class="room-settings"><div class="room-setting"><label class="field-label" for="setting-starting-health">STARTING HP</label>${isHost() ? `<select class="input lobby-setting-select" id="setting-starting-health" aria-label="Starting health">${healthOptions.map(([value, label]) => `<option value="${value}" ${value === state.startingHealth ? 'selected' : ''}>${value} HP · ${label}</option>`).join('')}</select>` : `<div class="setting-current">${state.startingHealth} HP · ${healthOptions.find(([value]) => value === state.startingHealth)?.[1] || 'Custom'}</div>`}</div><div class="room-setting"><label class="field-label" for="setting-round-limit">TIME PER GUESS</label>${isHost() ? `<select class="input lobby-setting-select" id="setting-round-limit" aria-label="Time per guess">${timeOptions.map(([value, label]) => `<option value="${value}" ${value === state.roundLimit ? 'selected' : ''}>${value} sec · ${label}</option>`).join('')}</select>` : `<div class="setting-current">${state.roundLimit} seconds</div>`}</div><div class="room-setting"><label class="field-label" for="setting-unit-system">SPEED UNITS</label>${isHost() ? `<select class="input lobby-setting-select" id="setting-unit-system" aria-label="Speed units">${unitOptions.map(([value, label]) => `<option value="${value}" ${value === (state.unitSystem || 'imperial') ? 'selected' : ''}>${label}</option>`).join('')}</select>` : `<div class="setting-current">${unitOptions.find(([value]) => value === state.unitSystem)?.[1] || 'Imperial · MPH'}</div>`}</div></div>`;
}
function lobby() {
  const players = state.players;
  const shareUrl = state.inviteUrl || `${location.origin}/?room=${state.code}`;
  return `<div class="game-layout"><section class="game-main"><div class="game-head"><div><div class="eyebrow"><span class="bar"></span> ROOM LOBBY</div><h1>Gather your crew.</h1></div><button class="room-code" id="copy-code"><small>ROOM CODE · TAP TO COPY</small>${state.code}</button></div>
    <div class="panel lobby-panel"><div class="panel-top"><div><div class="eyebrow">READY ROOM</div><h2 style="font-size:25px;margin:8px 0 0">Who’s in?</h2></div><span class="count-tag">${players.length} / 8 PLAYERS</span></div>
      <div class="player-grid">${players.map((p,i) => `<div class="player-chip"><span class="avatar">${escapeHtml(p.name.trim().charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(p.name)}${p.id === playerId ? ' <span style="color:#96a09a;font-weight:400">(you)</span>' : ''}</strong><small>${p.id === state.hostId ? 'HOST · READY' : 'READY TO RACE'}</small></div></div>`).join('')}</div>
      ${lobbySettings()}
      <div class="callout"><strong>Bring them in.</strong> Share the room code, or send the invite link: <a href="${escapeHtml(shareUrl)}" id="share-link" style="color:#637b39">${escapeHtml(shareUrl)}</a></div>
      ${isHost() ? `<div class="room-actions"><button class="btn btn-primary btn-full" id="start-game" ${players.length < 2 ? 'disabled' : ''}>${players.length < 2 ? 'Waiting for one more player…' : 'Start the game  →'}</button></div>` : '<div class="wait-note"><span class="spinner"></span> Waiting for the host to start the game…</div>'}
    </div></section><aside class="sidebar"><div class="side-card"><div class="side-title">HOW TO WIN</div><div class="callout">Everyone starts at <strong>${state.startingHealth} HP</strong>. Each wrong guess costs health in proportion to the slider range. Reach zero and you’re eliminated. The last player still alive wins.</div></div><div class="side-card"><div class="side-title">ROOM DETAILS</div><div class="online-count"><i></i>${players.length} PLAYERS IN THE ROOM</div><div style="font:11px var(--mono);color:#819087;margin-top:13px">SPEEDS IN ${unitLabel()} · ${state.roundLimit} SEC TO GUESS</div></div></aside></div>`;
}
function speedEnvironment(question) {
  const kind = question.kind.toLowerCase();
  if (kind.includes('spacecraft')) return 'space';
  if (['ocean', 'watercraft', 'sailboat', 'hydroplane'].some(term => kind.includes(term))) return 'ocean';
  if (kind.includes('aquatic mammal')) return 'ocean';
  if (kind.includes('rail')) return 'rail';
  if (['bird', 'aircraft', 'fighter jet', 'insect', 'gliding mammal'].some(term => kind.includes(term))) return 'sky';
  if (['car', 'motorcycle', 'bicycle', 'e-bike', 'scooter', 'low-speed vehicle', 'power mobility', 'golf cart', 'world record'].some(term => kind.includes(term))) return 'road';
  return 'field';
}
function environmentDetails(environment) {
  if (environment !== 'field') return '';
  const blades = [
    [2, 10, -1, 0], [7, 13, 2, -.05], [12, 8, 4, -.1], [18, 11, -2, -.15],
    [22, 9, 3, -.2], [27, 14, 0, -.25], [32, 10, 4, -.3], [37, 8, -1, -.35],
    [42, 12, 2, 0], [47, 9, 4, -.05], [52, 14, -2, -.1], [57, 8, 3, -.15],
    [62, 11, 0, -.2], [67, 9, 4, -.25], [72, 13, -1, -.3], [77, 8, 2, -.35],
    [82, 12, 3, 0], [87, 9, -2, -.05], [92, 14, 1, -.1], [97, 10, 4, -.15],
  ];
  return blades.map(([left, height, angle, delay]) =>
    `<span class="grass-blade" style="--blade-left:${left}%;--blade-height:${height}px;--blade-angle:${angle}deg;--sway-delay:${delay}s"><svg viewBox="0 0 12 20" aria-hidden="true"><path d="M5.2 20C6.3 14 6.4 8 2 1.5C8.5 5 9.2 12 6.1 20Z"/><path d="M5.6 20C4.5 14 2.7 11 1 8C5.2 11.5 7.1 16 6.6 20Z" opacity=".7"/><path d="M6 20C7.2 13 9.5 9 11 5C11.8 11.5 9 17 6.8 20Z" opacity=".8"/></svg></span>`
  ).join('');
}
function speedLanes(question, guess, revealed, unitSystem = state?.unitSystem) {
  const visual = questionVisuals[question.name] || {};
  const rawIcon = question.icon || visual.icon || '🏁';
  const icon = escapeHtml(rawIcon);
  const iconFacingClass = leftFacingIcons.has(rawIcon) ? ' turn-right' : '';
  const environment = speedEnvironment(question);
  const actualSpeed = question.speed ?? visual.speed;
  const range = displayRange(question, unitSystem);
  const actualDisplaySpeed = actualSpeed == null ? null : displaySpeed(actualSpeed, unitSystem);
  return `<div class="speed-lanes">
    <div class="speed-lane answer-lane ${revealed ? 'is-revealed' : ''}">
      <div class="lane-heading"><span>THE REAL SPEED</span><strong>${revealed && actualDisplaySpeed != null ? `${actualDisplaySpeed} ${unitLabel(unitSystem)}` : 'HIDDEN UNTIL REVEAL'}</strong></div>
      <div class="lane-track lane-track--${environment}"><div class="lane-environment lane-environment--${environment}" aria-hidden="true">${environmentDetails(environment)}</div><div class="lane-rail"></div><div class="lane-marker answer-marker ${revealed ? 'revealed' : 'silhouette'}" ${revealed ? 'id="answer-marker"' : ''} style="left:${revealed ? actualRunnerProgress * 100 : 50}%"><span class="lane-icon"><span class="directional-glyph${iconFacingClass}">${icon}</span></span></div></div>
    </div>
    <div class="speed-lane guess-lane">
      <div class="lane-heading"><span>YOUR GUESS</span><strong id="lane-guess-value">${guess == null ? '—' : `${guess} ${unitLabel(unitSystem)}`}</strong></div>
      <div class="lane-track guess-track"><div class="lane-rail"></div>${guess == null ? '<span class="no-guess">No guess submitted</span>' : `<div class="lane-marker guess-marker" id="guess-marker" style="left:${guessRunnerProgress * 100}%"><span class="lane-icon arrow-icon" aria-hidden="true"><svg viewBox="0 0 48 32"><path d="M4 16h34M26 5l12 11-12 11"/></svg></span></div>`}</div>
    </div>
  </div>`;
}
function gameView() {
  const me = currentPlayer();
  if (state.phase === 'finished') {
    return `<div class="game-layout round-layout"><section class="game-main"><div class="game-head"><div><div class="eyebrow"><span class="bar"></span> GAME OVER · ROOM ${state.code}</div><h1>The race is over.</h1></div><div class="room-code"><small>FINAL ROUND</small>${state.round}</div></div><div class="panel winner-panel"><div class="trophy">🏆</div><div class="eyebrow" style="justify-content:center;margin-top:16px">LAST ONE STANDING</div><h2>${escapeHtml(state.winner?.name || 'No winner')}</h2><p>Outlasted the whole crew and crossed the finish line.</p><div class="player-health-big">${state.winner ? state.players.find(p => p.id === state.winner.id)?.health : 0} <span style="font:12px var(--mono);color:#7e8b82">HP LEFT</span></div><div class="winner-actions">${isHost() ? '<button class="btn btn-primary" id="play-again">Play again</button>' : '<p class="wait-note">You’ll stay in this room while the host decides whether to play again.</p>'}<button class="btn" id="leave-game">Back to home</button></div></div></section><aside class="sidebar"><div class="side-card"><div class="side-title">FINAL HEALTH</div>${healthList(state.players)}</div></aside></div>`;
  }
  const guessing = state.phase === 'guessing'; const reveal = state.phase === 'reveal';
  const submitted = me?.submitted;
  const alivePlayers = state.players.filter(p => p.alive);
  const doneCount = alivePlayers.filter(p => p.submitted).length;
  const question = state.current;
  const maxGuess = displayRange(question);
  const seconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : 0;
  const guess = guessing ? (localGuess ?? Math.round(maxGuess / 2)) : me?.guess == null ? null : displaySpeed(me.guess);
  return `<div class="game-layout round-layout"><section class="game-main">
    <div class="game-head"><div><div class="eyebrow"><span class="bar"></span> ROUND ${String(state.round).padStart(2,'0')} · ${guessing ? 'MAKE YOUR GUESS' : 'ROUND RECAP'}</div><h1>${guessing ? 'How fast is it?' : 'The answer is in.'}</h1></div><button class="room-code" id="copy-code"><small>ROOM CODE</small>${state.code}</button></div>
    <div class="question-card ${reveal ? 'reveal-card' : ''}"><div class="eyebrow"><span class="bar"></span> ${escapeHtml(question.kind)}</div><div class="question-title-row"><h2>${escapeHtml(question.name)}</h2>${reveal && question.speed != null ? `<strong class="question-speed-reveal">${displaySpeed(question.speed)} ${unitShort()}</strong>` : ''}</div><p>${reveal ? escapeHtml(displaySpeedNote(question.note)) : 'What’s its top speed?'}</p>${guessing ? `<div class="timer">◷ &nbsp; <span id="timer-value">${seconds}</span> SEC</div>` : ''}</div>
    ${guessing ? `<div class="panel guess-card">${speedLanes(question, guess, false)}<div class="guess-control"><div class="guess-top"><label for="guess-slider">SET YOUR GUESSED SPEED</label><div class="guess-number"><span id="slider-value">${guess}</span> <small>${unitLabel()}</small></div></div><div class="range-wrap"><input class="range" id="guess-slider" type="range" min="0" max="${maxGuess}" value="${guess}" style="--progress:${guess / maxGuess * 100}%" step="1" aria-label="Set your speed guess in ${state.unitSystem === 'metric' ? 'kilometres per hour' : 'miles per hour'}" ${!me?.alive || submitted ? 'disabled' : ''}/></div><div class="range-labels"><span>0 ${unitShort()}</span><span>${maxGuess} ${unitShort()}</span></div></div><div class="guess-actions">${me?.alive ? (submitted ? `<span class="submit-message">✓ Guess locked in — waiting for the others</span>` : `<span class="submit-message" id="submit-message">${doneCount} of ${alivePlayers.length} guesses in</span><button class="btn btn-primary submit-btn" id="submit-guess">Lock it in  ↗</button>`) : `<span class="submit-message">You’re out — watch the rest of the race.</span>`}</div></div>` : `<div class="panel recap-panel">${speedLanes(question, guess, true)}<div class="panel-top"><div><div class="eyebrow">GUESS RECAP</div><h2 style="font-size:23px;margin:8px 0 0">Who was closest?</h2></div><span class="count-tag">${alivePlayers.length} STILL RACING</span></div><div class="results-list">${state.players.map(p => `<div class="result-row"><span>${escapeHtml(p.name)}${p.id === playerId ? ' (you)' : ''}${p.alive ? '' : ' · OUT'}</span><span class="result-guess">${p.guess == null ? '—' : `${displaySpeed(p.guess)} ${unitShort()}`}</span><span class="${p.damage === 0 ? 'safe' : 'damage'}">${p.damage == null ? '' : p.damage === 0 ? 'PERFECT' : `−${p.damage} HP`}</span></div>`).join('')}</div>${isHost() && reveal ? `<div class="room-actions"><button class="btn btn-primary btn-full" id="next-round">Next round  →</button></div>` : reveal ? `<div class="wait-note">Waiting for the host to start the next round…</div>` : ''}</div>`}
    </section><aside class="sidebar"><div class="side-card"><div class="panel-top"><div class="side-title" style="margin:0">HEALTH CHECK</div><span class="online-count"><i></i>${alivePlayers.length} ALIVE</span></div><div style="height:15px"></div>${healthList(state.players)}</div><div class="side-card"><div class="side-title">DAMAGE METER</div><div class="callout">The closer your slider is to the answer, the less health you lose. A perfect guess costs <strong>0 HP</strong>. ${guessing ? 'Miss the entire slider range and lose up to 100 HP.' : 'A missed guess at time runs out costs 100 HP.'}</div></div></aside></div>`;
}
function render() {
  if (!state) { createLanding(); return; }
  if (state.phase === 'lobby') view.innerHTML = lobby(); else view.innerHTML = gameView();
  requestAnimationFrame(() => view.querySelectorAll('.heart-fill').forEach(fill => {
    fill.style.clipPath = `inset(${100 - Number(fill.dataset.fill)}% 0 0 0)`;
  }));
  view.querySelector('#copy-code')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.code); notify('Room code copied'); } catch { notify(`Room code: ${state.code}`); } });
  view.querySelector('#start-game')?.addEventListener('click', () => api('start', { code: roomCode, playerId }).catch(e => notify(e.message)));
  view.querySelector('#next-round')?.addEventListener('click', () => api('next', { code: roomCode, playerId }).catch(e => notify(e.message)));
  const settingSelects = [...view.querySelectorAll('.lobby-setting-select')];
  if (settingSelects.length) {
    const saveSettings = async () => {
      settingSelects.forEach(select => { select.disabled = true; });
      try {
        const result = await api('settings', {
          code: roomCode, playerId,
          startingHealth: Number(view.querySelector('#setting-starting-health').value),
          roundLimit: Number(view.querySelector('#setting-round-limit').value),
          unitSystem: view.querySelector('#setting-unit-system').value,
        });
        receiveState(result.room);
      } catch (error) {
        notify(error.message);
        render();
      }
    };
    settingSelects.forEach(select => select.addEventListener('change', saveSettings));
  }
  view.querySelector('#play-again')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Opening the lobby…';
    try {
      const result = await api('replay', { code: roomCode, playerId });
      receiveState(result.room);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Play again';
      notify(error.message);
    }
  });
  view.querySelector('#leave-game')?.addEventListener('click', leaveRoom);
  const slider = view.querySelector('#guess-slider');
  slider?.addEventListener('input', () => {
    const value = Number(slider.value);
    localGuess = value;
    const readout = view.querySelector('#slider-value');
    if (readout) readout.textContent = String(value);
    const laneReadout = view.querySelector('#lane-guess-value');
    if (laneReadout) laneReadout.textContent = `${value} ${unitLabel()}`;
    guessRunnerRate = speedToRunnerRate(value, Number(slider.max));
    slider.style.setProperty('--progress', `${value / Number(slider.max) * 100}%`);
  });
  view.querySelector('#submit-guess')?.addEventListener('click', async () => { const button = view.querySelector('#submit-guess'); button.disabled = true; button.textContent = 'Locking…'; try { await api('guess', { code: roomCode, playerId, guess: Number(slider.value) }); } catch(e) { notify(e.message); } });
  clearInterval(clockTicker);
  if (state.phase === 'guessing') clockTicker = setInterval(() => { const timer = view.querySelector('#timer-value'); if (timer && state?.deadline) timer.textContent = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)); }, 250);
}

startRunnerLoop();
document.querySelector('.brand')?.addEventListener('click', event => {
  event.preventDefault();
  leaveRoom();
});
if (playerId && roomCode) connect(roomCode); else createLanding();
