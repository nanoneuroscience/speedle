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
const revealedQuestionImages = new Map();
const questionImageRequests = new Map();
const questionImageDecodeRequests = new Map();
const questionImageCreditRequests = new Map();
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
let soloMode = localStorage.getItem('speedle-solo-mode') === 'endless' ? 'endless' : 'daily';
let endlessDeckStatus = 'idle';
let endlessDeck = [];
let endlessError = '';
let endlessUsedNames = new Set();
let endlessPair = null;
let endlessSelectedObject = null;
let endlessRoundStatus = 'guessing';
let endlessIntroPhase = 'ready';
let endlessReady = true;
let endlessIntroTimer = null;
let endlessScore = 0;
let endlessBest = Number(localStorage.getItem('speedle-endless-best')) || 0;
let endlessUnitSystem = localStorage.getItem('speedle-endless-units') === 'metric' ? 'metric' : 'imperial';
let endlessRevealActive = false;
const leftFacingIcons = new Set([
  '🦅', '🐆', '🐟', '🦤', '🐈', '🐋', '🐕', '🦌', '🐅', '🐘', '🦒', '🐎', '🐪',
  '🦘', '🦬', '🦓', '🫎', '🐺', '🐻‍❄️', '🐇', '🦛', '🦏', '🐒', '🐦', '🦆',
  '🕊️', '🦈', '🐬', '🦭', '🐧', '🏎️', '🚘', '🚙', '🚄', '🏍️', '🚤', '🛥️',
]);

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const currentPlayer = () => state?.players.find(p => p.id === playerId);
const isHost = () => state?.hostId === playerId;
const KMH_PER_MPH = 1.609344;
const SLIDER_STEPS = 1000;
const MIN_GUESS_MPH = 1;
function unitShort(unitSystem = state?.unitSystem) { return unitSystem === 'metric' ? 'km/h' : 'mph'; }
function unitLabel(unitSystem = state?.unitSystem) { return unitSystem === 'metric' ? 'KM/H' : 'MPH'; }
function speedInUnit(mph, unitSystem = state?.unitSystem) { return unitSystem === 'metric' ? Number(mph) * KMH_PER_MPH : Number(mph); }
function formatSpeed(value) {
  const number = Number(value);
  const rounded = number >= 100 ? Math.round(number) : number >= 10 ? Number(number.toFixed(1)) : Number(number.toFixed(2));
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: number >= 100 ? 0 : number >= 10 ? 1 : 2 }).format(rounded);
}
function displaySpeed(mph, unitSystem = state?.unitSystem) { return formatSpeed(speedInUnit(mph, unitSystem)); }
function displayRange(question, unitSystem = state?.unitSystem) { return displaySpeed(question.range, unitSystem); }
function sliderPositionForMph(speedMph, question) {
  const max = Math.max(MIN_GUESS_MPH + Number.EPSILON, Number(question?.range) || MIN_GUESS_MPH + 1);
  const bounded = Math.max(MIN_GUESS_MPH, Math.min(max, Number(speedMph)));
  return Math.round(Math.log(bounded / MIN_GUESS_MPH) / Math.log(max / MIN_GUESS_MPH) * SLIDER_STEPS);
}
function mphFromSliderPosition(position, question) {
  const max = Math.max(MIN_GUESS_MPH + Number.EPSILON, Number(question?.range) || MIN_GUESS_MPH + 1);
  const ratio = Math.max(0, Math.min(SLIDER_STEPS, Number(position))) / SLIDER_STEPS;
  return MIN_GUESS_MPH * Math.pow(max / MIN_GUESS_MPH, ratio);
}
function displaySliderGuess(position, question, unitSystem = state?.unitSystem) {
  return formatSpeed(speedInUnit(mphFromSliderPosition(position, question), unitSystem));
}
function damageForGuess(guessMph, question) {
  return Math.min(100, Math.round(Math.abs(sliderPositionForMph(guessMph, question) - sliderPositionForMph(question.speed, question)) / (SLIDER_STEPS / 100)));
}
function speedToRunnerRate(speedMph, question) {
  if (Number(speedMph) <= 0) return 0;
  const ratio = sliderPositionForMph(speedMph, question) / SLIDER_STEPS;
  return 0.65 * (0.18 + 1.32 * ratio);
}
function displaySpeedNote(note, unitSystem = state?.unitSystem) {
  return String(note ?? '').replace(/(\d[\d,]*(?:\.\d+)?)\s*mph\b/gi, (_, value) => `${displaySpeed(Number(value.replaceAll(',', '')), unitSystem)} ${unitShort(unitSystem)}`);
}
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
        if (parsed.questionId === question.id) {
          dailyResult = parsed;
          dailyUnitSystem = parsed.unitSystem === 'metric' ? 'metric' : 'imperial';
          dailyGuess = sliderPositionForMph(parsed.guess, question);
        }
      } catch { localStorage.removeItem(dailyResultKey(day)); }
    }
    if (dailyResult) {
      guessRunnerRate = speedToRunnerRate(dailyResult.guess, question);
      actualRunnerRate = speedToRunnerRate(question.speed, question);
    } else {
      if (dailyGuess == null) dailyGuess = Math.round(SLIDER_STEPS / 2);
      guessRunnerRate = speedToRunnerRate(mphFromSliderPosition(dailyGuess, question), question);
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
  const totalScores = stats?.buckets?.reduce((sum, count) => sum + count, 0) || 0;
  if (!stats) return `<section class="daily-community" aria-live="polite">${header}<div class="community-message">The community distribution will appear here as results come in.</div></section>`;
  const shares = stats.buckets.map(count => totalScores ? count / totalScores : 0);
  const prior = stats.buckets.map((_, index) => Math.exp(-0.5 * Math.pow((index - 4.5) / 1.8, 2)));
  const priorTotal = prior.reduce((sum, weight) => sum + weight, 0);
  const combined = stats.buckets.map((count, index) => count + (prior[index] / priorTotal) * 40);
  const maxCombined = Math.max(...combined);
  const userBucket = Math.min(9, Math.floor(stats.myAccuracy / 10));
  const bars = stats.buckets.map((count, index) => {
    const share = shares[index];
    const height = Math.round(combined[index] / maxCombined * 100);
    const shareLabel = share ? `${share * 100 < 10 ? (share * 100).toFixed(1) : Math.round(share * 100)}%` : '';
    const label = index === 9 ? '90–100' : `${index * 10}–${index * 10 + 9}`;
    const detail = shareLabel ? `${shareLabel} of real scores` : 'bell-curve baseline only';
    return `<div class="community-bin ${index === userBucket ? 'is-your-score' : ''}" title="${label}% accuracy · ${detail}"><div class="community-bar-track"><i style="height:${height}%"></i></div></div>`;
  }).join('');
  const average = stats.averageAccuracy == null ? '—' : `${stats.averageAccuracy}%`;
  const percentile = stats.percentile == null ? '—' : `${stats.percentile}%`;
  return `<section class="daily-community" aria-live="polite">${header}<div class="community-stats"><div><strong>${average}</strong><span>AVERAGE ACCURACY</span></div><div><strong>${percentile}</strong><span>BEAT</span></div></div><div class="community-plot"><div class="community-y-axis" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div><div class="community-chart" role="img" aria-label="Bell-curve baseline combined with community scores in 10 percent ranges. The vertical scale is relative to the largest score range. Your score is ${stats.myAccuracy} percent.">${bars}</div></div><div class="community-x-axis" aria-hidden="true"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div><div class="community-axis-note"><span class="community-your-key"><i></i> YOUR SCORE RANGE</span></div></section>`;
}
function dailyPanel() {
  if (dailyDeckStatus === 'loading' || dailyDeckStatus === 'idle') return `<div class="daily-loading"><span class="spinner"></span> Loading today’s shared challenge…</div>`;
  if (dailyDeckStatus === 'error') return `<div class="daily-loading"><p>${escapeHtml(dailyError || 'Could not load today’s challenge.')}</p><button class="btn btn-primary btn-full" id="daily-retry">Try again</button></div>`;
  const question = dailyChallenge.question;
  const max = SLIDER_STEPS;
  const value = dailyGuess ?? Math.round(SLIDER_STEPS / 2);
  const result = dailyResult;
  const resultUnit = result?.unitSystem || dailyUnitSystem;
  const resultGuess = result ? displaySpeed(result.guess, resultUnit) : null;
  const shownGuess = result ? resultGuess : displaySliderGuess(value, question, dailyUnitSystem);
  const formattedDate = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dailyChallenge.day}T00:00:00Z`));
  const resultContent = result
    ? `<div class="daily-result"><div class="daily-score"><strong>${result.accuracy}%</strong><span>ACCURACY</span></div><div class="daily-result-values"><div><span>REAL SPEED</span><strong>${displaySpeed(question.speed, resultUnit)} ${unitShort(resultUnit)}</strong></div><div><span>YOUR GUESS</span><strong>${resultGuess} ${unitShort(resultUnit)}</strong></div><div><span>OFF BY</span><strong>${displaySpeed(Math.abs(result.guess - question.speed), resultUnit)} ${unitShort(resultUnit)}</strong></div></div></div>${dailyCommunityPanel()}<div class="hint daily-reset-hint">Come back tomorrow for a new challenge.</div>`
    : `<div class="daily-control-row"><div class="daily-unit-row"><div class="endless-unit-switch daily-unit-switch" id="daily-unit-system" role="group" aria-label="Daily Speedle speed units" data-active="${dailyUnitSystem}"><span class="endless-unit-indicator" aria-hidden="true"></span><button class="endless-unit-option ${dailyUnitSystem === 'imperial' ? 'is-active' : ''}" type="button" data-daily-unit="imperial" aria-pressed="${dailyUnitSystem === 'imperial'}">MPH</button><button class="endless-unit-option ${dailyUnitSystem === 'metric' ? 'is-active' : ''}" type="button" data-daily-unit="metric" aria-pressed="${dailyUnitSystem === 'metric'}">KM/H</button></div></div><div class="guess-control daily-guess-control"><div class="guess-top"><label for="daily-guess-slider">SET YOUR GUESSED SPEED</label><div class="guess-number"><span id="daily-guess-readout">${displaySliderGuess(value, question, dailyUnitSystem)}</span> <small>${unitLabel(dailyUnitSystem)}</small></div></div><div class="range-wrap"><input class="range" id="daily-guess-slider" type="range" min="0" max="${max}" value="${value}" step="1" style="--progress:${value / max * 100}%" aria-label="Set your daily speed guess in ${dailyUnitSystem === 'metric' ? 'kilometres per hour' : 'miles per hour'}"/></div><div class="range-labels"><span>${displaySpeed(MIN_GUESS_MPH, dailyUnitSystem)} ${unitShort(dailyUnitSystem)}</span><span>${displayRange(question, dailyUnitSystem)} ${unitShort(dailyUnitSystem)}</span></div></div><button class="btn btn-primary daily-submit" id="daily-submit">Reveal today’s speed</button></div>`;
  return `<div class="daily-head"><div><h2>Daily Speedle</h2></div><span class="count-tag">${escapeHtml(formattedDate)}</span></div>
    <div class="daily-question-strip"><div class="daily-question-copy"><div class="eyebrow">${escapeHtml(question.kind)}</div><h3>${escapeHtml(question.name)}</h3><p>${result ? escapeHtml(displaySpeedNote(question.note, resultUnit)) : 'What’s its top speed?'}</p></div>${questionImageMarkup(question, 'daily-question-image')}</div>
    <div class="daily-lanes-wrap">${speedLanes(question, shownGuess, Boolean(result), resultUnit)}</div>${resultContent}`;
}
function renderDailyCard() {
  const content = view.querySelector('#daily-challenge-content');
  if (!content || state) return;
  content.innerHTML = dailyPanel();
  if (dailyChallenge?.question) {
    loadQuestionImage(dailyChallenge.question, 'daily-question-image');
    if (revealedQuestionImages.get(dailyChallenge.question.name)) renderQuestionImage(dailyChallenge.question.name, 'daily-question-image');
  }
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
  view.querySelectorAll('[data-daily-unit]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.dailyUnit === dailyUnitSystem) return;
    dailyUnitSystem = button.dataset.dailyUnit;
    localStorage.setItem('speedle-daily-units', dailyUnitSystem);
    guessRunnerRate = speedToRunnerRate(mphFromSliderPosition(dailyGuess ?? SLIDER_STEPS / 2, dailyChallenge.question), dailyChallenge.question);
    renderDailyCard();
  }));
  view.querySelector('#daily-guess-slider')?.addEventListener('input', event => {
    dailyGuess = Number(event.currentTarget.value);
    const question = dailyChallenge.question;
    guessRunnerRate = speedToRunnerRate(mphFromSliderPosition(dailyGuess, question), question);
    const readout = view.querySelector('#daily-guess-readout');
    if (readout) readout.textContent = displaySliderGuess(dailyGuess, question, dailyUnitSystem);
    event.currentTarget.style.setProperty('--progress', `${dailyGuess / SLIDER_STEPS * 100}%`);
  });
  view.querySelector('#daily-submit')?.addEventListener('click', () => {
    const question = dailyChallenge.question;
    const canonicalGuess = Number(mphFromSliderPosition(dailyGuess ?? SLIDER_STEPS / 2, question).toPrecision(12));
    const damage = damageForGuess(canonicalGuess, question);
    dailyResult = { question: question.name, questionId: question.id, guess: canonicalGuess, unitSystem: dailyUnitSystem, accuracy: 100 - damage };
    localStorage.setItem(dailyResultKey(dailyChallenge.day), JSON.stringify(dailyResult));
    guessRunnerProgress = 0;
    actualRunnerProgress = 0;
    guessRunnerRate = speedToRunnerRate(canonicalGuess, question);
    actualRunnerRate = speedToRunnerRate(question.speed, question);
    renderDailyCard();
    void refreshDailyCommunity(true);
  });
}
async function loadEndlessDeck() {
  if (endlessDeckStatus === 'loading' || endlessDeckStatus === 'ready') return;
  endlessDeckStatus = 'loading';
  renderEndlessCard();
  try {
    const response = await fetch('/daily-deck.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load the speed deck.');
    const deck = await response.json();
    endlessDeck = Array.isArray(deck) ? deck.filter(item => item && item.name && Number.isFinite(Number(item.speed))) : [];
    if (endlessDeck.length < 2) throw new Error('The speed deck needs at least two objects.');
    endlessDeckStatus = 'ready';
    if (!endlessPair) startEndlessGame();
  } catch (error) {
    endlessDeckStatus = 'error';
    endlessError = error.message;
    renderEndlessCard();
  }
}
function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function drawEndlessPair() {
  let available = endlessDeck.filter(item => !endlessUsedNames.has(item.name));
  if (available.length < 2) {
    endlessUsedNames = new Set();
    available = endlessDeck;
  }
  const ordered = shuffled(available);
  const first = ordered[0];
  let second = ordered.find(item => Number(item.speed) !== Number(first.speed));
  if (!second) {
    endlessUsedNames = new Set();
    const fullDeck = shuffled(endlessDeck);
    const fallbackFirst = fullDeck[0];
    second = fullDeck.find(item => Number(item.speed) !== Number(fallbackFirst.speed));
    if (!second) {
      endlessDeckStatus = 'error';
      endlessError = 'Could not find two objects with different speeds.';
      endlessPair = null;
      return;
    }
    endlessUsedNames.add(fallbackFirst.name);
    endlessUsedNames.add(second.name);
    endlessPair = shuffled([fallbackFirst, second]);
    endlessSelectedObject = null;
    endlessRoundStatus = 'guessing';
    endlessIntroPhase = 'loading';
    endlessReady = false;
    return;
  }
  endlessUsedNames.add(first.name);
  endlessUsedNames.add(second.name);
  endlessPair = shuffled([first, second]);
  endlessSelectedObject = null;
  endlessRoundStatus = 'guessing';
  endlessIntroPhase = 'loading';
  endlessReady = false;
}
function startEndlessGame() {
  if (endlessDeckStatus !== 'ready') return;
  clearTimeout(endlessIntroTimer);
  endlessScore = 0;
  endlessUsedNames = new Set();
  endlessError = '';
  drawEndlessPair();
  renderEndlessCard();
  void prepareEndlessRound();
}
async function prepareEndlessRound() {
  const pair = endlessPair;
  if (!pair) return;
  await Promise.all(pair.map(async (item, index) => {
    await loadQuestionImage(item);
    if (endlessPair === pair) renderQuestionImage(item.name, `endless-object-image-${index}`);
  }));
  if (endlessPair !== pair || endlessIntroPhase !== 'loading') return;
  endlessIntroPhase = 'left';
  updateEndlessIntroStage();
  runEndlessIntro();
}
function runEndlessIntro() {
  clearTimeout(endlessIntroTimer);
  const sequence = [['right', 450], ['three', 520], ['two', 520], ['one', 520], ['go', 650], ['ready', 0]];
  let step = 0;
  function advance() {
    if (step >= sequence.length) return;
    const [phase, delay] = sequence[step++];
    endlessIntroPhase = phase;
    endlessReady = phase === 'ready';
    updateEndlessIntroStage();
    if (delay) endlessIntroTimer = setTimeout(advance, delay);
  }
  endlessIntroTimer = setTimeout(advance, 560);
}
function chooseEndlessObject(index) {
  if (!endlessPair || !endlessReady || endlessRoundStatus !== 'guessing') return;
  const chosen = endlessPair[index];
  const faster = endlessPair[0].speed > endlessPair[1].speed ? endlessPair[0] : endlessPair[1];
  const target = faster;
  if (chosen === target) {
    endlessScore += 1;
    if (endlessScore > endlessBest) {
      endlessBest = endlessScore;
      localStorage.setItem('speedle-endless-best', String(endlessBest));
    }
    endlessRoundStatus = 'correct';
  } else {
    endlessRoundStatus = 'over';
  }
  endlessRevealActive = true;
  try { renderEndlessCard(); } finally { endlessRevealActive = false; }
}
function endlessPanel() {
  if (endlessDeckStatus === 'idle' || endlessDeckStatus === 'loading') return `<div class="daily-loading"><span class="spinner"></span> Loading the speed deck…</div>`;
  if (endlessDeckStatus === 'error') return `<div class="daily-loading"><p>${escapeHtml(endlessError || 'Could not load the speed deck.')}</p><button class="btn btn-primary btn-full" id="endless-retry">Try again</button></div>`;
  if (!endlessPair) return `<div class="daily-loading"><p>Couldn’t find a new pair. Try again.</p><button class="btn btn-primary btn-full" id="endless-restart">Start again</button></div>`;
  const answered = endlessRoundStatus !== 'guessing';
  const faster = endlessPair[0].speed > endlessPair[1].speed ? endlessPair[0] : endlessPair[1];
  const target = faster;
  const title = endlessRoundStatus === 'correct' ? 'That’s right!' : endlessRoundStatus === 'over' ? 'Run over' : 'Which is faster?';
  const message = endlessRoundStatus === 'correct'
    ? `${escapeHtml(target.name)} is faster. Keep the streak going.`
    : endlessRoundStatus === 'over'
      ? `${escapeHtml(target.name)} was faster. Your streak ends at ${endlessScore}.`
      : endlessIntroPhase === 'loading' ? 'Getting the images ready…' : 'Pick the faster object.';
  const choices = endlessPair.map((item, index) => {
    const isFaster = item === faster;
    const selected = answered && item === endlessSelectedObject;
    const classNames = ['endless-choice'];
    const phaseIndex = ['left', 'right', 'three', 'two', 'one', 'go', 'ready'].indexOf(endlessIntroPhase);
    if (endlessIntroPhase === 'loading') classNames.push('endless-hidden');
    else if (index === 0) classNames.push(phaseIndex === 0 ? 'endless-enter-left' : 'endless-visible');
    else classNames.push(phaseIndex < 1 ? 'endless-hidden' : phaseIndex === 1 ? 'endless-enter-right' : 'endless-visible');
    if (answered && isFaster) classNames.push('is-faster');
    else if (answered) classNames.push('is-slower');
    if (selected && endlessRoundStatus === 'over') classNames.push('is-picked-wrong');
    if (endlessRevealActive) {
      classNames.push('is-revealing');
      if (selected) classNames.push('is-picked-now');
    }
    const speed = answered ? `<span class="endless-speed">${displaySpeed(item.speed, endlessUnitSystem)} <small>${unitShort(endlessUnitSystem)}</small></span>` : '';
    const label = answered ? `${item.name}: ${displaySpeed(item.speed, endlessUnitSystem)} ${unitShort(endlessUnitSystem)}` : `Choose ${item.name} as the faster object`;
    const imageId = `endless-object-image-${index}`;
    return `<button class="${classNames.join(' ')}" type="button" data-endless-choice="${index}" aria-label="${escapeHtml(label)}" ${answered || !endlessReady ? 'disabled' : ''}>${questionImageMarkup(item, imageId)}<div class="endless-choice-content"><span class="endless-choice-kind">${escapeHtml(item.kind || 'OBJECT')}</span><strong>${escapeHtml(item.name)}</strong>${speed}</div></button>`;
  }).join('');
  const phaseIndex = ['left', 'right', 'three', 'two', 'one', 'go', 'ready'].indexOf(endlessIntroPhase);
  const countdownText = { three: '3', two: '2', one: '1', go: 'GO!' }[endlessIntroPhase];
  const vs = endlessIntroPhase === 'ready' ? '<div class="endless-vs is-visible" aria-hidden="true">VS</div>' : '';
  const countdown = countdownText ? `<div class="endless-countdown ${endlessIntroPhase === 'go' ? 'is-go' : ''}" role="status" aria-live="assertive"><span>${countdownText}</span></div>` : '';
  const resultClass = endlessRoundStatus === 'correct' ? 'is-correct' : endlessRoundStatus === 'over' ? 'is-over' : '';
  const action = endlessRoundStatus === 'correct'
    ? '<button class="btn btn-primary" id="endless-next">Next pair <span aria-hidden="true">→</span></button>'
    : endlessRoundStatus === 'over'
      ? '<button class="btn btn-primary" id="endless-restart">Play again</button>'
      : '';
  const feedback = `<div class="endless-feedback ${resultClass} ${endlessRevealActive ? 'is-entering' : ''}" aria-live="polite"><div><strong>${title}</strong><span>${answered ? message : endlessIntroPhase === 'loading' ? message : endlessReady ? message : 'Wait for GO! to make your pick.'}</span></div>${action}</div>`;
  return `<div class="endless-head"><div><h2>Endless Speedle</h2><p>Choose the faster object. Keep your streak alive.</p></div><div class="endless-unit-control"><div class="endless-unit-switch" id="endless-unit-system" role="group" aria-label="Endless game speed units" data-active="${endlessUnitSystem}"><span class="endless-unit-indicator" aria-hidden="true"></span><button class="endless-unit-option ${endlessUnitSystem === 'imperial' ? 'is-active' : ''}" type="button" data-endless-unit="imperial" aria-pressed="${endlessUnitSystem === 'imperial'}" ${endlessReady ? '' : 'disabled'}>MPH</button><button class="endless-unit-option ${endlessUnitSystem === 'metric' ? 'is-active' : ''}" type="button" data-endless-unit="metric" aria-pressed="${endlessUnitSystem === 'metric'}" ${endlessReady ? '' : 'disabled'}>KM/H</button></div></div></div><div class="endless-scoreboard"><div><strong>${endlessScore}</strong><span>STREAK</span></div><div><strong>${endlessBest}</strong><span>BEST</span></div></div><div class="endless-stage" id="endless-stage" data-phase="${escapeHtml(endlessIntroPhase)}"><div class="endless-pair">${choices}</div>${vs}${countdown}</div>${feedback}`;
}
function updateEndlessIntroStage() {
  const stage = view.querySelector('#endless-stage');
  if (!stage) return;
  const phaseIndex = ['left', 'right', 'three', 'two', 'one', 'go', 'ready'].indexOf(endlessIntroPhase);
  stage.dataset.phase = endlessIntroPhase;
  stage.querySelectorAll('.endless-choice').forEach((card, index) => {
    card.classList.remove('endless-hidden', 'endless-visible', 'endless-enter-left', 'endless-enter-right');
    card.disabled = !endlessReady || endlessRoundStatus !== 'guessing';
    if (index === 0) card.classList.add(endlessIntroPhase === 'left' ? 'endless-enter-left' : 'endless-visible');
    else if (phaseIndex < 1) card.classList.add('endless-hidden');
    else if (phaseIndex === 1) card.classList.add('endless-enter-right');
    else card.classList.add('endless-visible');
  });
  view.querySelectorAll('#endless-unit-system [data-endless-unit]').forEach(button => { button.disabled = !endlessReady; });
  const feedback = view.querySelector('.endless-feedback span');
  if (feedback) feedback.textContent = endlessIntroPhase === 'loading' ? 'Getting the images ready…' : endlessReady ? 'Pick the faster object.' : 'Wait for GO! to make your pick.';

  let vs = stage.querySelector('.endless-vs');
  if (endlessIntroPhase === 'ready') {
    if (!vs) {
      stage.insertAdjacentHTML('beforeend', '<div class="endless-vs is-entering" aria-hidden="true">VS</div>');
      vs = stage.querySelector('.endless-vs');
    } else {
      vs.className = 'endless-vs is-visible';
    }
  } else {
    vs?.remove();
  }

  const countdownText = { three: '3', two: '2', one: '1', go: 'GO!' }[endlessIntroPhase];
  let countdown = stage.querySelector('.endless-countdown');
  if (!countdownText) {
    countdown?.remove();
    return;
  }
  if (!countdown) {
    stage.insertAdjacentHTML('beforeend', `<div class="endless-countdown ${endlessIntroPhase === 'go' ? 'is-go' : ''}" role="status" aria-live="assertive"><span>${countdownText}</span></div>`);
    return;
  }
  countdown.classList.toggle('is-go', endlessIntroPhase === 'go');
  const number = countdown.querySelector('span:first-child');
  if (number?.textContent !== countdownText) {
    const updatedNumber = document.createElement('span');
    updatedNumber.textContent = countdownText;
    if (number) number.replaceWith(updatedNumber);
    else countdown.prepend(updatedNumber);
  }
}
function renderEndlessCard() {
  const content = view.querySelector('#endless-challenge-content');
  if (!content || state) return;
  content.innerHTML = endlessPanel();
  endlessPair?.forEach((item, index) => {
    const imageId = `endless-object-image-${index}`;
    void loadQuestionImage(item).then(() => {
      if (endlessPair?.[index]?.name === item.name) renderQuestionImage(item.name, imageId);
    });
  });
  view.querySelector('#endless-retry')?.addEventListener('click', () => {
    endlessDeckStatus = 'idle'; endlessError = ''; void loadEndlessDeck();
  });
  view.querySelector('#endless-restart')?.addEventListener('click', startEndlessGame);
  view.querySelector('#endless-next')?.addEventListener('click', () => {
    drawEndlessPair();
    renderEndlessCard();
    void prepareEndlessRound();
  });
  view.querySelectorAll('[data-endless-unit]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled || button.dataset.endlessUnit === endlessUnitSystem) return;
    endlessUnitSystem = button.dataset.endlessUnit;
    localStorage.setItem('speedle-endless-units', endlessUnitSystem);
    renderEndlessCard();
  }));
  view.querySelectorAll('[data-endless-choice]').forEach(button => button.addEventListener('click', () => {
    endlessSelectedObject = endlessPair[Number(button.dataset.endlessChoice)];
    chooseEndlessObject(Number(button.dataset.endlessChoice));
  }));
}
function setSoloMode(mode) {
  soloMode = mode === 'endless' ? 'endless' : 'daily';
  localStorage.setItem('speedle-solo-mode', soloMode);
  const dailyContent = view.querySelector('#daily-challenge-content');
  const endlessContent = view.querySelector('#endless-challenge-content');
  dailyContent?.classList.toggle('hidden', soloMode !== 'daily');
  endlessContent?.classList.toggle('hidden', soloMode !== 'endless');
  view.querySelectorAll('[data-solo-mode]').forEach(button => {
    const active = button.dataset.soloMode === soloMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (soloMode === 'endless') void loadEndlessDeck();
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
function decodeWikiText(value) {
  const element = document.createElement('textarea');
  element.innerHTML = String(value || '').replace(/<[^>]*>/g, ' ');
  return element.value.replace(/\s+/g, ' ').trim();
}
function preloadQuestionImageSource(src) {
  if (questionImageDecodeRequests.has(src)) return questionImageDecodeRequests.get(src);
  const request = new Promise(resolve => {
    const preload = new Image();
    let settled = false;
    const finish = loaded => {
      if (settled) return;
      settled = true;
      resolve(loaded);
    };
    preload.decoding = 'async';
    preload.fetchPriority = 'high';
    preload.referrerPolicy = 'no-referrer';
    preload.onload = () => {
      if (typeof preload.decode === 'function') preload.decode().then(() => finish(true), () => finish(preload.naturalWidth > 0));
      else finish(preload.naturalWidth > 0);
    };
    preload.onerror = () => finish(false);
    preload.src = src;
    if (preload.complete) {
      if (preload.naturalWidth > 0) preload.onload();
      else preload.onerror();
    }
  });
  questionImageDecodeRequests.set(src, request);
  return request;
}
async function loadQuestionImage(question) {
  const name = question?.name;
  if (!name) return null;
  if (questionImageRequests.has(name)) return questionImageRequests.get(name);
  if (revealedQuestionImages.has(name)) return revealedQuestionImages.get(name);
  const request = (async () => {
    try {
      if (!question.imagePath) throw new Error('No image for this question.');
      const image = {
        src: question.imagePath,
        pageUrl: question.imageSourceUrl || '',
        credit: question.imageCredit || '',
        licenseUrl: question.imageLicenseUrl || '',
      };
      revealedQuestionImages.set(name, image);
      const decoded = await preloadQuestionImageSource(image.src);
      if (!decoded) { revealedQuestionImages.set(name, null); return null; }
      if (state?.current?.name === name && ['guessing', 'reveal', 'finished'].includes(state.phase)) renderQuestionImage(name, 'question-image');
      if (!state && dailyChallenge?.question?.name === name) renderQuestionImage(name, 'daily-question-image');
      if (!state && endlessPair?.some(item => item.name === name)) {
        const index = endlessPair.findIndex(item => item.name === name);
        renderQuestionImage(name, `endless-object-image-${index}`);
      }
      return image;
    } catch {
      revealedQuestionImages.set(name, null);
      return null;
    } finally {
      questionImageRequests.delete(name);
    }
  })();
  questionImageRequests.set(name, request);
  return request;
}
function renderQuestionImage(name, containerId = 'question-image') {
  const container = view.querySelector(`#${containerId}`);
  if (!container || !revealedQuestionImages.has(name)) return;
  const image = revealedQuestionImages.get(name);
  if (!image) {
    container.replaceChildren(Object.assign(document.createElement('span'), { className: 'image-loading', textContent: 'Image unavailable' }));
    container.classList.add('image-unavailable');
    return;
  }
  if (container.querySelector('.question-image')?.src === image.src) {
    renderQuestionImageCredit(name, containerId);
    return;
  }
  const img = document.createElement('img');
  img.src = image.src;
  img.alt = name;
  img.loading = 'eager';
  img.decoding = 'async';
  img.fetchPriority = 'high';
  img.referrerPolicy = 'no-referrer';
  img.className = 'question-image';
  img.addEventListener('error', () => {
    container.replaceChildren(Object.assign(document.createElement('span'), { className: 'image-loading', textContent: 'Image unavailable' }));
    container.classList.add('image-unavailable');
  }, { once: true });
  container.replaceChildren(img);
  renderQuestionImageCredit(name, containerId);
  container.classList.remove('image-unavailable');
}
function renderQuestionImageCredit(name, containerId) {
  const container = view.querySelector(`#${containerId}`);
  const image = revealedQuestionImages.get(name);
  if (!container || !image || (!image.pageUrl && !image.licenseUrl)) return;
  let caption = container.querySelector('.image-credit');
  if (!caption) {
    caption = document.createElement('div');
    caption.className = 'image-credit';
    container.append(caption);
  }
  caption.replaceChildren();
  if (image.pageUrl) {
    const source = document.createElement('a');
    source.href = image.pageUrl;
    source.target = '_blank';
    source.rel = 'noreferrer';
    source.textContent = image.credit || new URL(image.pageUrl).hostname.replace(/^www\./, '');
    caption.append(source);
  } else if (image.credit) {
    caption.append(document.createTextNode(image.credit));
  }
  if (image.licenseUrl) {
    if (caption.childNodes.length) caption.append(document.createTextNode(' · '));
    const license = document.createElement('a');
    license.href = image.licenseUrl;
    license.target = '_blank';
    license.rel = 'noreferrer';
    license.textContent = 'License';
    caption.append(license);
  }
}
function questionImageMarkup(question, containerId = 'question-image') {
  const result = revealedQuestionImages.get(question?.name);
  const dailyImage = containerId === 'daily-question-image';
  const endlessImage = containerId.startsWith('endless-object-image-');
  const className = dailyImage ? 'question-image-wrap daily-question-image' : `question-image-wrap${endlessImage ? ' endless-card-image' : ''}`;
  return `<div class="${className}" id="${containerId}" aria-live="polite">${result === null ? '<span class="image-loading">Image unavailable</span>' : '<span class="image-loading">Finding an image…</span>'}</div>`;
}
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
    localGuess = Math.round(SLIDER_STEPS / 2);
    guessRunnerProgress = 0;
    actualRunnerProgress = 0;
    guessRunnerRate = speedToRunnerRate(mphFromSliderPosition(localGuess, nextState.current), nextState.current);
    actualRunnerRate = 0;
  }
  if ((nextState.phase === 'reveal' || nextState.phase === 'finished') && animationRevealRound !== nextState.round) {
    animationRevealRound = nextState.round;
    const submittedGuess = nextState.players.find(p => p.id === playerId)?.guess;
    const actualSpeed = nextState.current?.speed;
    guessRunnerProgress = 0;
    actualRunnerProgress = 0;
    guessRunnerRate = submittedGuess == null ? 0 : speedToRunnerRate(submittedGuess, nextState.current);
    actualRunnerRate = actualSpeed == null ? 0 : speedToRunnerRate(actualSpeed, nextState.current);
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
      <div class="hero-pitches"><div class="hero-pitch"><span>WITH FRIENDS</span><strong>Challenge your friends</strong><p>Join a room and see who can outlast the group.</p></div><div class="hero-pitch"><span>ON YOUR OWN</span><strong>Train with Daily Speedle</strong><p>Play today’s solo guess or take on Endless Speedle.</p></div></div>
    </div>
    <div class="entry-card"><div class="tabs"><button class="tab ${selectedTab === 'create' ? 'active' : ''}" data-tab="create">Create a room</button><button class="tab ${selectedTab === 'join' ? 'active' : ''}" data-tab="join">Join a room</button></div>
      <form id="entry-form"><div class="form-row"><label class="field-label" for="player-name">YOUR NAME</label><input id="player-name" class="input" placeholder="What should we call you?" maxlength="18" autocomplete="nickname" required /></div>
      <div class="form-row ${selectedTab === 'join' ? '' : 'hidden'}" id="join-field"><label class="field-label" for="room-code-input">ROOM CODE</label><input id="room-code-input" class="input join-code" placeholder="E.G. J7KM" maxlength="4" autocomplete="off" /></div>
      <button class="btn btn-primary btn-full" type="submit">${selectedTab === 'create' ? 'Create a room  ↗' : 'Join the game  →'}</button></form>
      <p class="hint">${selectedTab === 'create' ? 'You’ll get a code to share. Friends can join from any phone on the same Wi-Fi.' : inviteRoomCode ? 'You were invited to a room. Add your name and jump in.' : 'Ask your host for their room code and join the lobby.'}</p>
    </div>
  </section><section class="rules"><div class="rule"><span class="rule-no">01</span><strong>Pick your speed</strong><span>Slide to your best guess of the object’s top speed.</span></div><div class="rule"><span class="rule-no">02</span><strong>Protect your health</strong><span>Miss by more, lose more. Damage is capped at 100 HP each round.</span></div><div class="rule"><span class="rule-no">03</span><strong>Stay in the race</strong><span>Hit zero and you’re out. Last one standing wins.</span></div></section>
  <section class="daily-section"><div class="daily-game-panel panel"><div class="solo-mode-tabs" role="tablist" aria-label="Solo game modes"><button class="solo-mode-tab ${soloMode === 'daily' ? 'active' : ''}" type="button" role="tab" data-solo-mode="daily" aria-selected="${soloMode === 'daily'}">Daily Speedle</button><button class="solo-mode-tab ${soloMode === 'endless' ? 'active' : ''}" type="button" role="tab" data-solo-mode="endless" aria-selected="${soloMode === 'endless'}">Endless</button></div><div id="daily-challenge-content" class="${soloMode === 'daily' ? '' : 'hidden'}">${dailyPanel()}</div><div id="endless-challenge-content" class="${soloMode === 'endless' ? '' : 'hidden'}">${endlessPanel()}</div></div></section>`;
  const roomCodeInput = view.querySelector('#room-code-input');
  if (inviteRoomCode && roomCodeInput) roomCodeInput.value = inviteRoomCode;
  view.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    selectedTab = button.dataset.tab;
    // Keep the invite code available if they switch back, but let the selected tab
    // survive a reload instead of reapplying the invite link's join default.
    history.replaceState({}, '', selectedTab === 'join' && inviteRoomCode ? `/?room=${inviteRoomCode}` : '/');
    createLanding();
  }));
  view.querySelectorAll('[data-solo-mode]').forEach(button => button.addEventListener('click', () => setSoloMode(button.dataset.soloMode)));
  view.querySelector('#entry-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const name = view.querySelector('#player-name').value.trim();
    try {
      const result = selectedTab === 'create' ? await api('create', { name }) : await api('join', { name, code: view.querySelector('#room-code-input').value.trim().toUpperCase() });
      saveSession(result.playerId, result.room.code); receiveState(result.room); connect(result.room.code); history.replaceState({}, '', `/?room=${result.room.code}`);
    } catch (error) { notify(error.message); }
  });
  renderDailyCard();
  loadDailyChallenge();
  setSoloMode(soloMode);
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
  if (kind.includes('space')) return 'space';
  if (['sea', 'ocean', 'watercraft', 'sailboat', 'hydroplane', 'aquatic'].some(term => kind.includes(term))) return 'ocean';
  if (kind.includes('rail')) return 'rail';
  if (['air', 'bird', 'aircraft', 'jet', 'insect', 'weather'].some(term => kind.includes(term))) return 'sky';
  if (['machine', 'vehicle', 'historic', 'record', 'car', 'motorcycle', 'bicycle', 'sports'].some(term => kind.includes(term))) return 'road';
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
  const rawIcon = question.icon || '🏁';
  const icon = escapeHtml(rawIcon);
  const iconFacingClass = leftFacingIcons.has(rawIcon) ? ' turn-right' : '';
  const environment = speedEnvironment(question);
  const actualSpeed = question.speed;
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
    loadQuestionImage(state.current);
    return `<div class="game-layout round-layout"><section class="game-main"><div class="game-head"><div><div class="eyebrow"><span class="bar"></span> GAME OVER · ROOM ${state.code}</div><h1>The race is over.</h1></div><div class="room-code"><small>FINAL ROUND</small>${state.round}</div></div><div class="question-card reveal-card final-question-card"><div class="eyebrow"><span class="bar"></span> ${escapeHtml(state.current?.kind)}</div><div class="question-title-row"><h2>${escapeHtml(state.current?.name)}</h2>${state.current?.speed != null ? `<strong class="question-speed-reveal">${displaySpeed(state.current.speed)} ${unitShort()}</strong>` : ''}</div><p>${escapeHtml(displaySpeedNote(state.current?.note))}</p>${questionImageMarkup(state.current)}</div><div class="panel winner-panel"><div class="trophy">🏆</div><div class="eyebrow" style="justify-content:center;margin-top:16px">LAST ONE STANDING</div><h2>${escapeHtml(state.winner?.name || 'No winner')}</h2><p>Outlasted the whole crew and crossed the finish line.</p><div class="player-health-big">${state.winner ? state.players.find(p => p.id === state.winner.id)?.health : 0} <span style="font:12px var(--mono);color:#7e8b82">HP LEFT</span></div><div class="winner-actions">${isHost() ? '<button class="btn btn-primary" id="play-again">Play again</button>' : '<p class="wait-note">You’ll stay in this room while the host decides whether to play again.</p>'}<button class="btn" id="leave-game">Back to home</button></div></div></section><aside class="sidebar"><div class="side-card"><div class="side-title">FINAL HEALTH</div>${healthList(state.players)}</div></aside></div>`;
  }
  const guessing = state.phase === 'guessing'; const reveal = state.phase === 'reveal';
  const submitted = me?.submitted;
  const alivePlayers = state.players.filter(p => p.alive);
  const doneCount = alivePlayers.filter(p => p.submitted).length;
  const question = state.current;
  loadQuestionImage(question);
  const maxGuess = displayRange(question);
  const guessPosition = localGuess ?? Math.round(SLIDER_STEPS / 2);
  const seconds = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : 0;
  const guess = guessing ? displaySliderGuess(guessPosition, question) : me?.guess == null ? null : displaySpeed(me.guess);
  return `<div class="game-layout round-layout"><section class="game-main">
    <div class="game-head"><div><div class="eyebrow"><span class="bar"></span> ROUND ${String(state.round).padStart(2,'0')} · ${guessing ? 'MAKE YOUR GUESS' : 'ROUND RECAP'}</div><h1>${guessing ? 'How fast is it?' : 'The answer is in.'}</h1></div><button class="room-code" id="copy-code"><small>ROOM CODE</small>${state.code}</button></div>
    <div class="question-card ${reveal ? 'reveal-card' : ''}"><div class="eyebrow"><span class="bar"></span> ${escapeHtml(question.kind)}</div><div class="question-title-row"><h2>${escapeHtml(question.name)}</h2>${reveal && question.speed != null ? `<strong class="question-speed-reveal">${displaySpeed(question.speed)} ${unitShort()}</strong>` : ''}</div><p>${reveal ? escapeHtml(displaySpeedNote(question.note)) : 'What’s its top speed?'}</p>${questionImageMarkup(question)}${guessing ? `<div class="timer">◷ &nbsp; <span id="timer-value">${seconds}</span> SEC</div>` : ''}</div>
    ${guessing ? `<div class="panel guess-card">${speedLanes(question, guess, false)}<div class="guess-control"><div class="guess-top"><label for="guess-slider">SET YOUR GUESSED SPEED</label><div class="guess-number"><span id="slider-value">${guess}</span> <small>${unitLabel()}</small></div></div><div class="range-wrap"><input class="range" id="guess-slider" type="range" min="0" max="${SLIDER_STEPS}" value="${guessPosition}" style="--progress:${guessPosition / SLIDER_STEPS * 100}%" step="1" aria-label="Set your speed guess in ${state.unitSystem === 'metric' ? 'kilometres per hour' : 'miles per hour'}" ${!me?.alive || submitted ? 'disabled' : ''}/></div><div class="range-labels"><span>${displaySpeed(MIN_GUESS_MPH)} ${unitShort()}</span><span>${maxGuess} ${unitShort()}</span></div></div><div class="guess-actions">${me?.alive ? (submitted ? `<span class="submit-message">✓ Guess locked in — waiting for the others</span>` : `<span class="submit-message" id="submit-message">${doneCount} of ${alivePlayers.length} guesses in</span><button class="btn btn-primary submit-btn" id="submit-guess">Lock it in  ↗</button>`) : `<span class="submit-message">You’re out — watch the rest of the race.</span>`}</div></div>` : `<div class="panel recap-panel">${speedLanes(question, guess, true)}<div class="panel-top"><div><div class="eyebrow">GUESS RECAP</div><h2 style="font-size:23px;margin:8px 0 0">Who was closest?</h2></div><span class="count-tag">${alivePlayers.length} STILL RACING</span></div><div class="results-list">${state.players.map(p => `<div class="result-row"><span>${escapeHtml(p.name)}${p.id === playerId ? ' (you)' : ''}${p.alive ? '' : ' · OUT'}</span><span class="result-guess">${p.guess == null ? '—' : `${displaySpeed(p.guess)} ${unitShort()}`}</span><span class="${p.damage === 0 ? 'safe' : 'damage'}">${p.damage == null ? '' : p.damage === 0 ? 'PERFECT' : `−${p.damage} HP`}</span></div>`).join('')}</div>${isHost() && reveal ? `<div class="room-actions"><button class="btn btn-primary btn-full" id="next-round">Next round  →</button></div>` : reveal ? `<div class="wait-note">Waiting for the host to start the next round…</div>` : ''}</div>`}
    </section><aside class="sidebar"><div class="side-card"><div class="panel-top"><div class="side-title" style="margin:0">HEALTH CHECK</div><span class="online-count"><i></i>${alivePlayers.length} ALIVE</span></div><div style="height:15px"></div>${healthList(state.players)}</div><div class="side-card"><div class="side-title">DAMAGE METER</div><div class="callout">The closer your slider is to the answer, the less health you lose. A perfect guess costs <strong>0 HP</strong>. ${guessing ? 'Miss the entire slider range and lose up to 100 HP.' : 'A missed guess at time runs out costs 100 HP.'}</div></div></aside></div>`;
}
function render() {
  if (!state) { createLanding(); return; }
  if (state.phase === 'lobby') view.innerHTML = lobby(); else view.innerHTML = gameView();
  if (state.current && revealedQuestionImages.get(state.current.name)) renderQuestionImage(state.current.name);
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
    const shownGuess = displaySliderGuess(value, state.current);
    const readout = view.querySelector('#slider-value');
    if (readout) readout.textContent = shownGuess;
    const laneReadout = view.querySelector('#lane-guess-value');
    if (laneReadout) laneReadout.textContent = `${shownGuess} ${unitLabel()}`;
    guessRunnerRate = speedToRunnerRate(mphFromSliderPosition(value, state.current), state.current);
    slider.style.setProperty('--progress', `${value / SLIDER_STEPS * 100}%`);
  });
  view.querySelector('#submit-guess')?.addEventListener('click', async () => { const button = view.querySelector('#submit-guess'); button.disabled = true; button.textContent = 'Locking…'; try { const guess = Number(mphFromSliderPosition(Number(slider.value), state.current).toPrecision(12)); await api('guess', { code: roomCode, playerId, guess }); } catch(e) { notify(e.message); } });
  clearInterval(clockTicker);
  if (state.phase === 'guessing') clockTicker = setInterval(() => { const timer = view.querySelector('#timer-value'); if (timer && state?.deadline) timer.textContent = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)); }, 250);
}

startRunnerLoop();
document.querySelector('.brand')?.addEventListener('click', event => {
  event.preventDefault();
  leaveRoom();
});
if (playerId && roomCode) connect(roomCode); else createLanding();
