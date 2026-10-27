import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ClimbError, createClimbEngine } from './climb.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();
const streams = new Map();
const persistentDiskDir = '/var/data';
const scoreDataDir = process.env.SPEEDLE_DATA_DIR || (existsSync(persistentDiskDir) ? persistentDiskDir : path.join(os.tmpdir(), 'speedle-data'));
const scoreDataFile = path.join(scoreDataDir, 'daily-scores.json');
let dailyScoreStore = null;
let dailyScoreStoreDay = null;
let dailyScoreStoreQuestionId = null;
let dailyScoreWrites = Promise.resolve();
const lanAddress = Object.values(os.networkInterfaces()).flat().find(x => x && x.family === 'IPv4' && !x.internal)?.address || 'localhost';
const gameOrigin = (process.env.PUBLIC_URL || 'https://speedle.lol').replace(/\/+$/, '');
const dailyDeck = JSON.parse(await readFile(path.join(here, 'public', 'daily-deck.json'), 'utf8'));
if (!Array.isArray(dailyDeck) || !dailyDeck.length) throw new Error('The daily question deck is empty.');

const deck = dailyDeck;
const climb = createClimbEngine({ deck: dailyDeck, dataDir: scoreDataDir, describe: objectBlurb });

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function objectBlurb(note) {
  return String(note ?? '')
    .replace(/\s*\.?\s*Image shows a generic example.*$/i, '')
    .replace(/\s*[;,]?\s*derived from\b.*$/i, '')
    .replace(/\b(?:up to|as high as)\s+\d[\d,.]*(?:\s*[–-]\s*\d[\d,.]*)?\s*(?:mph|km\/h|km\/s|m\/s|mi\/h)\b/gi, 'record speeds')
    .replace(/\s*\([^)]*\b(?:Mach\s*\d|\d[\d,.]*\s*(?:mph|km\/h|km\/s|m\/s|mi\/h))[^)]*\)/gi, '')
    .replace(/\b(?:about|approximately|roughly|~)\s*\d[\d,.]*(?:\s*[–-]\s*\d[\d,.]*)?\s*(?:mph|km\/h|km\/s|m\/s|mi\/h)\b/gi, '')
    .replace(/\bMach\s*\d[\d,.]*/gi, '')
    .replace(/\b\d[\d,.]*(?:\s*[–-]\s*\d[\d,.]*)?\s*(?:mph|km\/h|km\/s|m\/s|mi\/h|c)\b/gi, '')
    .replace(/:\s*\d[\d,.]*(?:\s*s|:\d{2})\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/[,;:]\s*$/, '')
    .replace(/\b(?:at|to|of|for|in|with|by)\s*$/i, '')
    .trim();
}
function safeRoom(room) {
  const answerVisible = room.phase === 'reveal' || room.phase === 'finished';
  return {
    code: room.code, hostId: room.hostId, inviteUrl: `${gameOrigin}/?room=${room.code}`, phase: room.phase, round: room.round,
    startingHealth: room.startingHealth, roundLimit: room.roundLimit, unitSystem: room.unitSystem, deadline: room.deadline, current: room.current ? {
      id: room.current.id, name: room.current.name, kind: room.current.kind, icon: room.current.icon,
      range: room.current.range, sliderMin: 1, blurb: objectBlurb(room.current.note), note: answerVisible ? room.current.note : undefined, source: answerVisible ? room.current.source : undefined,
      secondarySource: answerVisible ? room.current.secondarySource : undefined, imagePath: room.current.imagePath,
      imageSourceUrl: room.current.imageSourceUrl, imageCredit: room.current.imageCredit,
      imageLicenseUrl: room.current.imageLicenseUrl,
      speed: answerVisible ? room.current.speed : undefined,
    } : null,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, health: p.health, connected: p.connected, submitted: p.guess != null, guess: room.phase === 'reveal' || room.phase === 'finished' ? p.guess : undefined, damage: p.damage, alive: p.health > 0 })),
    winner: room.winner ? { id: room.winner.id, name: room.winner.name } : null,
  };
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}
function utcDayNumber(day) {
  const [year, month, date] = day.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 86400000);
}
function dailyQuestionFor(day) {
  const index = ((utcDayNumber(day) % dailyDeck.length) + dailyDeck.length) % dailyDeck.length;
  return dailyDeck[index];
}
function currentStreakForDay(profile, day) {
  if (!profile?.lastPlayedDay || !Number.isInteger(profile.currentStreak)) return 0;
  const daysSincePlayed = utcDayNumber(day) - utcDayNumber(profile.lastPlayedDay);
  return daysSincePlayed >= 0 && daysSincePlayed <= 1 ? profile.currentStreak : 0;
}
function sliderPositionForSpeed(speed, question) {
  const min = 1;
  const max = Number(question.range);
  const bounded = Math.max(min, Math.min(max, Number(speed)));
  return Math.round(Math.log(bounded / min) / Math.log(max / min) * 1000);
}
function damageForGuess(guess, question) {
  return Math.min(100, Math.round(Math.abs(sliderPositionForSpeed(guess, question) - sliderPositionForSpeed(question.speed, question)) / 10));
}
function participantHash(day, id) {
  return createHash('sha256').update(`${day}:${id}`).digest('hex');
}
function profileHash(id) {
  return createHash('sha256').update(`profile:${id}`).digest('hex');
}
const blockedNameFragments = [
  'nigger', 'niggers', 'nigga', 'niggas', 'darkie', 'darkies', 'zipperhead', 'zipperheads',
  'wetback', 'wetbacks', 'raghead', 'ragheads', 'towelhead', 'towelheads', 'faggot', 'faggots',
  'tranny', 'trannies', 'shemale', 'shemales', 'retard', 'retards', 'retarded', 'mongoloid',
  'jigaboo', 'jiggaboo', 'porchmonkey', 'porchmonkeys', 'polack', 'polacks',
];
const blockedNameWords = [
  'coon', 'coons', 'chink', 'chinks', 'gook', 'gooks', 'spic', 'spics', 'spick', 'spicks',
  'kike', 'kikes', 'heeb', 'heebs', 'fag', 'fags', 'dyke', 'dykes', 'paki', 'pakis',
  'kraut', 'krauts', 'honky', 'honkies', 'jap',
];
function normalizedName(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[0134578@!|$]/g, char => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '!': 'i', '|': 'i', '$': 's' })[char]);
}
function containsBlockedName(value) {
  const normalized = normalizedName(value);
  const compact = normalized.replace(/[^a-z]/g, '');
  const words = normalized.split(/[^a-z]+/).filter(Boolean);
  return blockedNameFragments.some(term => compact.includes(term)) || blockedNameWords.some(term => words.includes(term));
}
function defaultProfile(id) {
  return { displayName: `Speedster ${id.replaceAll('-', '').slice(0, 4).toUpperCase()}`, currentStreak: 0, bestStreak: 0, lastPlayedDay: null };
}
function cleanDisplayName(value) {
  return Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 18).join('');
}
function publicProfile(profile, day = new Date().toISOString().slice(0, 10)) {
  return { displayName: containsBlockedName(profile.displayName) ? 'Speedster' : profile.displayName, currentStreak: currentStreakForDay(profile, day), bestStreak: profile.bestStreak };
}
function updateProfileStreak(profile, day) {
  if (profile.lastPlayedDay === day) return profile;
  const previousDay = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  profile.currentStreak = profile.lastPlayedDay === previousDay ? profile.currentStreak + 1 : 1;
  profile.bestStreak = Math.max(profile.bestStreak, profile.currentStreak);
  profile.lastPlayedDay = day;
  return profile;
}
async function persistDailyScoreStore() {
  await mkdir(scoreDataDir, { recursive: true });
  const temporaryFile = `${scoreDataFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(dailyScoreStore), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, scoreDataFile);
}
async function loadDailyScoreStore(day, questionId) {
  if (dailyScoreStoreDay === day && dailyScoreStoreQuestionId === questionId && dailyScoreStore) return dailyScoreStore;
  let previous = null;
  try { previous = JSON.parse(await readFile(scoreDataFile, 'utf8')); } catch {}
  const sameDayStore = previous?.day === day && previous?.questionId === questionId && previous.participants && typeof previous.participants === 'object';
  const profiles = previous?.profiles && typeof previous.profiles === 'object' ? previous.profiles : {};
  const endlessScores = previous?.endlessScores && typeof previous.endlessScores === 'object' ? previous.endlessScores : {};
  dailyScoreStore = { version: 2, day, questionId, participants: sameDayStore ? previous.participants : {}, profiles, endlessScores };
  dailyScoreStoreDay = day;
  dailyScoreStoreQuestionId = questionId;
  await persistDailyScoreStore();
  return dailyScoreStore;
}
function dailyScoreSummary(day, currentParticipantHash) {
  const currentScore = dailyScoreStore.participants[currentParticipantHash];
  if (!Number.isInteger(currentScore) || currentScore < 0 || currentScore > 100) return null;
  const others = Object.entries(dailyScoreStore.participants)
    .filter(([hash, score]) => hash !== currentParticipantHash && Number.isInteger(score) && score >= 0 && score <= 100)
    .map(([, score]) => score);
  const buckets = Array(10).fill(0);
  for (const score of others) buckets[Math.min(9, Math.floor(score / 10))] += 1;
  const averageAccuracy = others.length ? Math.round(others.reduce((sum, score) => sum + score, 0) / others.length) : null;
  const below = others.filter(score => score < currentScore).length;
  const tied = others.filter(score => score === currentScore).length;
  const percentile = others.length ? Math.round((below + tied / 2) / others.length * 100) : null;
  return { day, myAccuracy: currentScore, averageAccuracy, percentile, buckets };
}
async function readJsonBody(req, limit = 4096) {
  let body = '';
  for await (const part of req) {
    body += part;
    if (body.length > limit) throw new Error('Request is too large.');
  }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Invalid request.'); }
}
function publish(room) {
  const payload = `data: ${JSON.stringify(safeRoom(room))}\n\n`;
  for (const response of streams.get(room.code) || []) response.write(payload);
}
function resolveRound(room) {
  if (room.phase !== 'guessing') return;
  room.phase = 'reveal';
  room.deadline = null;
  for (const p of room.players.values()) {
    if (p.health <= 0) continue;
    if (p.guess == null) p.damage = 100;
    else if (p.guess != null) p.damage = damageForGuess(p.guess, room.current);
    if (p.damage != null) p.health = Math.max(0, p.health - p.damage);
  }
  const alive = [...room.players.values()].filter(p => p.health > 0);
  if (alive.length === 1) { room.phase = 'finished'; room.winner = alive[0]; }
  publish(room);
}
function resolveExpiredRound(room) {
  if (room.phase === 'guessing' && room.deadline != null && room.deadline <= Date.now()) {
    resolveRound(room);
  }
}
function beginRound(room) {
  const options = deck.filter(q => !room.usedQuestionNames.has(q.name));
  if (!options.length) return false;
  room.current = options[Math.floor(Math.random() * options.length)];
  room.usedQuestionNames.add(room.current.name);
  room.round += 1;
  room.phase = 'guessing';
  room.deadline = Date.now() + room.roundLimit * 1000;
  for (const p of room.players.values()) { p.guess = null; p.damage = null; }
  publish(room);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  if (url.pathname === '/api/climb' || url.pathname === '/api/climb/answer') {
    const expectedMethod = url.pathname === '/api/climb' ? 'GET' : 'POST';
    if (req.method !== expectedMethod) return send(res, 405, { error: `Use ${expectedMethod}.` });
    try {
      if (req.method === 'GET') return send(res, 200, await climb.get(url.searchParams.get('participant') || ''));
      let data;
      try { data = await readJsonBody(req); } catch (error) { return send(res, 400, { error: error.message }); }
      return send(res, 200, await climb.answer(data));
    } catch (error) {
      if (error instanceof ClimbError) return send(res, error.status, { error: error.message });
      console.error('Could not load or save the daily climb:', error.message);
      return send(res, 503, { error: 'Your climb could not be saved right now. Please try again.' });
    }
  }
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const code = (url.searchParams.get('room') || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'Room not found.' });
    resolveExpiredRound(room);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    res.write(`data: ${JSON.stringify(safeRoom(room))}\n\n`);
    if (!streams.has(code)) streams.set(code, new Set());
    streams.get(code).add(res);
    req.on('close', () => streams.get(code)?.delete(res));
    return;
  }
  if (url.pathname === '/api/daily-leaderboard') {
    if (req.method !== 'GET') return send(res, 405, { error: 'Use GET.' });
    const day = url.searchParams.get('day') || '';
    const participantId = url.searchParams.get('participant') || '';
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day !== today) return send(res, 409, { error: 'Today’s challenge has changed. Reload the page to continue.' });
    if (!/^[0-9a-f-]{36}$/i.test(participantId)) return send(res, 400, { error: 'Could not load your player profile.' });
    try {
      const operation = dailyScoreWrites.then(async () => {
        const store = await loadDailyScoreStore(day, dailyQuestionFor(day).id);
        const key = profileHash(participantId);
        const profile = store.profiles[key] || defaultProfile(participantId);
        if (!store.profiles[key]) {
          dailyScoreStore = { ...store, profiles: { ...store.profiles, [key]: profile } };
          try { await persistDailyScoreStore(); } catch (error) { dailyScoreStore = store; throw error; }
        }
        const ranked = Object.entries(dailyScoreStore.participants)
          .filter(([hash, accuracy]) => dailyScoreStore.profiles[hash] && Number.isInteger(accuracy) && accuracy >= 0 && accuracy <= 100)
          .map(([hash, accuracy]) => ({ hash, accuracy, profile: dailyScoreStore.profiles[hash] }))
          .sort((a, b) => b.accuracy - a.accuracy || currentStreakForDay(b.profile, day) - currentStreakForDay(a.profile, day) || a.profile.displayName.localeCompare(b.profile.displayName));
        const myRank = ranked.findIndex(row => row.hash === key) + 1 || null;
        const myAccuracy = dailyScoreStore.participants[key] ?? null;
        return {
          day,
          profile: publicProfile(dailyScoreStore.profiles[key], day),
          entries: ranked.slice(0, 10).map((row, index) => ({ rank: index + 1, displayName: publicProfile(row.profile, day).displayName, accuracy: row.accuracy, currentStreak: currentStreakForDay(row.profile, day) })),
          myRank,
          myAccuracy,
        };
      });
      dailyScoreWrites = operation.catch(() => {});
      return send(res, 200, await operation);
    } catch (error) {
      console.error('Could not read the daily leaderboard:', error.message);
      return send(res, 503, { error: 'The daily leaderboard is temporarily unavailable.' });
    }
  }
  if (url.pathname === '/api/endless-leaderboard') {
    if (req.method !== 'GET') return send(res, 405, { error: 'Use GET.' });
    const participantId = url.searchParams.get('participant') || '';
    const day = new Date().toISOString().slice(0, 10);
    if (!/^[0-9a-f-]{36}$/i.test(participantId)) return send(res, 400, { error: 'Could not load the Endless leaderboard.' });
    try {
      const operation = dailyScoreWrites.then(async () => {
        const store = await loadDailyScoreStore(day, dailyQuestionFor(day).id);
        const key = profileHash(participantId);
        if (!store.profiles[key]) {
          dailyScoreStore = { ...store, profiles: { ...store.profiles, [key]: defaultProfile(participantId) } };
          try { await persistDailyScoreStore(); } catch (error) { dailyScoreStore = store; throw error; }
        }
        const validScores = Object.entries(dailyScoreStore.endlessScores || {})
          .filter(([hash, score]) => dailyScoreStore.profiles[hash] && Number.isInteger(score) && score > 0)
          .map(([hash, bestScore]) => ({ hash, bestScore, profile: dailyScoreStore.profiles[hash] }))
          .sort((a, b) => b.bestScore - a.bestScore || a.profile.displayName.localeCompare(b.profile.displayName));
        const myRank = validScores.findIndex(row => row.hash === key) + 1 || null;
        return {
          profile: publicProfile(dailyScoreStore.profiles[key], day),
          entries: validScores.slice(0, 10).map((row, index) => ({ rank: index + 1, displayName: publicProfile(row.profile, day).displayName, bestScore: row.bestScore })),
          myRank,
          myBestScore: dailyScoreStore.endlessScores?.[key] || 0,
        };
      });
      dailyScoreWrites = operation.catch(() => {});
      return send(res, 200, await operation);
    } catch (error) {
      console.error('Could not read the Endless leaderboard:', error.message);
      return send(res, 503, { error: 'The Endless leaderboard is temporarily unavailable.' });
    }
  }
  if (url.pathname === '/api/endless-score') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
    let data;
    try { data = await readJsonBody(req); } catch (error) { return send(res, 400, { error: error.message }); }
    const participantId = String(data.participantId || '');
    const score = Number(data.score);
    const day = new Date().toISOString().slice(0, 10);
    if (!/^[0-9a-f-]{36}$/i.test(participantId)) return send(res, 400, { error: 'Could not save your Endless score.' });
    if (!Number.isSafeInteger(score) || score < 1 || score > 100000) return send(res, 400, { error: 'That Endless score is invalid.' });
    const operation = dailyScoreWrites.then(async () => {
      const store = await loadDailyScoreStore(day, dailyQuestionFor(day).id);
      const key = profileHash(participantId);
      const previousBest = Number.isSafeInteger(store.endlessScores?.[key]) ? store.endlessScores[key] : 0;
      const profiles = store.profiles[key] ? store.profiles : { ...store.profiles, [key]: defaultProfile(participantId) };
      if (score <= previousBest && profiles === store.profiles) return { saved: true, bestScore: previousBest };
      dailyScoreStore = {
        ...store,
        profiles,
        endlessScores: score > previousBest ? { ...(store.endlessScores || {}), [key]: score } : (store.endlessScores || {}),
      };
      try { await persistDailyScoreStore(); } catch (error) { dailyScoreStore = store; throw error; }
      return { saved: true, bestScore: Math.max(previousBest, score) };
    });
    dailyScoreWrites = operation.catch(() => {});
    try { return send(res, 200, await operation); }
    catch (error) {
      console.error('Could not save Endless score:', error.message);
      return send(res, 503, { error: 'Your Endless score could not be saved right now.' });
    }
  }
  if (url.pathname === '/api/daily-profile') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
    let data;
    try { data = await readJsonBody(req); } catch (error) { return send(res, 400, { error: error.message }); }
    const participantId = String(data.participantId || '');
    const displayName = cleanDisplayName(data.displayName);
    if (!/^[0-9a-f-]{36}$/i.test(participantId)) return send(res, 400, { error: 'Could not save your player profile.' });
    if (!displayName) return send(res, 400, { error: 'Enter a display name.' });
    if (containsBlockedName(displayName)) return send(res, 400, { error: 'That name isn’t allowed. Please choose another.' });
    const day = new Date().toISOString().slice(0, 10);
    const operation = dailyScoreWrites.then(async () => {
      const store = await loadDailyScoreStore(day, dailyQuestionFor(day).id);
      const key = profileHash(participantId);
      const profile = { ...(store.profiles[key] || defaultProfile(participantId)), displayName };
      dailyScoreStore = { ...store, profiles: { ...store.profiles, [key]: profile } };
      try { await persistDailyScoreStore(); } catch (error) { dailyScoreStore = store; throw error; }
      return publicProfile(profile, day);
    });
    dailyScoreWrites = operation.catch(() => {});
    try { return send(res, 200, { profile: await operation }); }
    catch (error) {
      console.error('Could not save the daily profile:', error.message);
      return send(res, 503, { error: 'Your profile could not be saved right now.' });
    }
  }
  if (url.pathname === '/api/daily-scores') {
    if (req.method === 'GET') {
      const day = url.searchParams.get('day') || '';
      const participantId = url.searchParams.get('participant') || '';
      const today = new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day !== today) return send(res, 409, { error: 'Today’s challenge has changed. Reload the page to continue.' });
      if (!/^[0-9a-f-]{36}$/i.test(participantId)) return send(res, 400, { error: 'Could not load your community score.' });
      try {
        const operation = dailyScoreWrites.then(async () => {
          await loadDailyScoreStore(day, dailyQuestionFor(day).id);
          return dailyScoreSummary(day, profileHash(participantId)) || dailyScoreSummary(day, participantHash(day, participantId));
        });
        dailyScoreWrites = operation.catch(() => {});
        const summary = await operation;
        if (!summary) return send(res, 409, { error: 'Submit today’s guess before viewing the distribution.' });
        return send(res, 200, summary);
      } catch (error) {
        console.error('Could not read daily scores:', error.message);
        return send(res, 503, { error: 'Community scores are temporarily unavailable.' });
      }
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
    let data;
    try { data = await readJsonBody(req); } catch (error) { return send(res, 400, { error: error.message }); }
    const day = String(data.day || '');
    const participantId = String(data.participantId || '');
    const guess = Number(data.guess);
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day !== today) return send(res, 409, { error: 'Today’s challenge has changed. Reload the page to continue.' });
    if (!/^[0-9a-f-]{36}$/i.test(participantId)) return send(res, 400, { error: 'Could not save your score.' });
    const question = dailyQuestionFor(day);
    if (!Number.isFinite(guess) || guess < 1 || guess > question.range) return send(res, 400, { error: 'Choose a speed within today’s range.' });
    const accuracy = 100 - damageForGuess(guess, question);
    const hash = profileHash(participantId);
    const legacyHash = participantHash(day, participantId);
    const operation = dailyScoreWrites.then(async () => {
      const store = await loadDailyScoreStore(day, question.id);
      const participants = { ...store.participants };
      if (!Object.hasOwn(participants, hash)) participants[hash] = Object.hasOwn(participants, legacyHash) ? participants[legacyHash] : accuracy;
      delete participants[legacyHash];
      const key = hash;
      const profile = { ...(store.profiles[key] || defaultProfile(participantId)) };
      updateProfileStreak(profile, day);
      if (Object.hasOwn(store.participants, hash) && store.profiles[key]?.lastPlayedDay === day && !Object.hasOwn(store.participants, legacyHash)) return;
      dailyScoreStore = { ...store, participants, profiles: { ...store.profiles, [key]: profile } };
      try { await persistDailyScoreStore(); } catch (error) { dailyScoreStore = store; throw error; }
    });
    dailyScoreWrites = operation.catch(() => {});
    try {
      await operation;
      return send(res, 200, { saved: true });
    } catch (error) {
      console.error('Could not save daily score:', error.message);
      return send(res, 503, { error: 'Your score could not be added right now.' });
    }
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
    let body = '';
    for await (const part of req) body += part;
    let data;
    try { data = JSON.parse(body || '{}'); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const action = url.pathname.slice(5);
    if (action === 'create') {
      const name = cleanDisplayName(data.name);
      if (!name) return send(res, 400, { error: 'Enter a name to create a room.' });
      if (containsBlockedName(name)) return send(res, 400, { error: 'That name isn’t allowed. Please choose another.' });
      let code; do { code = roomCode(); } while (rooms.has(code));
      const id = randomUUID();
      const room = { code, hostId: id, players: new Map([[id, { id, name, health: 200, connected: true, guess: null, damage: null }]]), phase: 'lobby', round: 0, startingHealth: 200, roundLimit: 30, unitSystem: 'imperial', deadline: null, current: null, usedQuestionNames: new Set(), winner: null };
      rooms.set(code, room); return send(res, 200, { playerId: id, room: safeRoom(room) });
    }
    const code = String(data.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'That room code was not found.' });
    resolveExpiredRound(room);
    if (action === 'join') {
      const name = cleanDisplayName(data.name);
      if (!name) return send(res, 400, { error: 'Enter a name to join.' });
      if (containsBlockedName(name)) return send(res, 400, { error: 'That name isn’t allowed. Please choose another.' });
      if (room.phase !== 'lobby') return send(res, 409, { error: 'This game has already started.' });
      if (room.players.size >= 8) return send(res, 409, { error: 'This room is full (8 players max).' });
      if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'That name is already in this room.' });
      const id = randomUUID(); room.players.set(id, { id, name, health: room.startingHealth, connected: true, guess: null, damage: null });
      publish(room); return send(res, 200, { playerId: id, room: safeRoom(room) });
    }
    const player = room.players.get(data.playerId);
    if (action !== 'state' && !player) return send(res, 403, { error: 'You are not in this room.' });
    if (action === 'state') return send(res, 200, { room: safeRoom(room) });
    if (action === 'start') {
      if (player.id !== room.hostId) return send(res, 403, { error: 'Only the host can start.' });
      if (room.phase !== 'lobby' || room.players.size < 2) return send(res, 409, { error: 'At least 2 players are needed to start.' });
      if (!beginRound(room)) return send(res, 409, { error: 'All unique objects have been used in this game. Create a new room to play again.' });
      return send(res, 200, { room: safeRoom(room) });
    }
    if (action === 'settings') {
      if (player.id !== room.hostId) return send(res, 403, { error: 'Only the host can change game settings.' });
      if (room.phase !== 'lobby') return send(res, 409, { error: 'Game settings can only be changed in the lobby.' });
      const startingHealth = Number(data.startingHealth);
      const roundLimit = Number(data.roundLimit);
      const unitSystem = String(data.unitSystem || '');
      if (![100, 200, 300].includes(startingHealth)) return send(res, 400, { error: 'Choose 100, 200, or 300 starting HP.' });
      if (![15, 30, 45].includes(roundLimit)) return send(res, 400, { error: 'Choose a guess timer from the available options.' });
      if (!['imperial', 'metric'].includes(unitSystem)) return send(res, 400, { error: 'Choose Imperial or Metric units.' });
      room.startingHealth = startingHealth;
      room.roundLimit = roundLimit;
      room.unitSystem = unitSystem;
      for (const p of room.players.values()) { p.health = startingHealth; p.guess = null; p.damage = null; }
      publish(room); return send(res, 200, { room: safeRoom(room) });
    }
    if (action === 'guess') {
      if (room.phase !== 'guessing' || player.health <= 0) return send(res, 409, { error: 'Guesses are closed.' });
      const guess = Number(data.guess);
      if (!Number.isFinite(guess) || guess < 1 || guess > room.current.range) return send(res, 400, { error: 'Choose a speed within the slider.' });
      player.guess = Number(guess.toPrecision(12)); publish(room);
      const active = [...room.players.values()].filter(p => p.health > 0);
      if (active.every(p => p.guess != null)) resolveRound(room);
      return send(res, 200, { room: safeRoom(room) });
    }
    if (action === 'next') {
      if (player.id !== room.hostId) return send(res, 403, { error: 'Only the host can continue.' });
      if (room.phase !== 'reveal') return send(res, 409, { error: 'The round is still in progress.' });
      if (!beginRound(room)) return send(res, 409, { error: 'All unique objects have been used in this game. Create a new room to play again.' });
      return send(res, 200, { room: safeRoom(room) });
    }
    if (action === 'replay') {
      if (player.id !== room.hostId) return send(res, 403, { error: 'Only the host can start another game.' });
      if (room.phase !== 'finished') return send(res, 409, { error: 'This game has not finished yet.' });
      room.phase = 'lobby';
      room.round = 0;
      room.deadline = null;
      room.current = null;
      room.usedQuestionNames = new Set();
      room.winner = null;
      for (const p of room.players.values()) { p.health = room.startingHealth; p.guess = null; p.damage = null; }
      publish(room); return send(res, 200, { room: safeRoom(room) });
    }
    return send(res, 404, { error: 'Unknown action.' });
  }
  let requested;
  try {
    requested = decodeURIComponent(url.pathname === '/' ? (url.searchParams.has('room') ? 'index.html' : 'mountain.html') : url.pathname === '/classic' || url.pathname === '/classic/' ? 'index.html' : url.pathname.slice(1));
  }
  catch { return send(res, 400, { error: 'Invalid file path.' }); }
  const publicRoot = path.resolve(here, 'public');
  const file = path.resolve(publicRoot, requested);
  if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) return send(res, 403, { error: 'Forbidden.' });
  try {
    const content = await import('node:fs/promises').then(fs => fs.readFile(file));
    const extension = path.extname(file).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    };
    const headers = { 'content-type': types[extension] || 'application/octet-stream', 'x-content-type-options': 'nosniff' };
    if (file.startsWith(`${publicRoot}${path.sep}images${path.sep}`)) headers['cache-control'] = 'public, max-age=31536000, immutable';
    else headers['cache-control'] = 'no-cache';
    res.writeHead(200, headers); res.end(content);
  } catch { send(res, 404, { error: 'Not found.' }); }
});

setInterval(() => {
  for (const room of rooms.values()) resolveExpiredRound(room);
}, 500);

server.listen(PORT, HOST, () => {
  const addresses = Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => `http://${x.address}:${PORT}`);
  console.log(`Speedle is ready at http://localhost:${PORT}${addresses.length ? `\nOn your Wi-Fi: ${addresses.join(', ')}` : ''}`);
});
