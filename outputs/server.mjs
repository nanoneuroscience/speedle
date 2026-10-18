import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();
const streams = new Map();
const scoreDataDir = process.env.SPEEDLE_DATA_DIR || path.join(os.tmpdir(), 'speedle-data');
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

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function safeRoom(room) {
  const answerVisible = room.phase === 'reveal' || room.phase === 'finished';
  return {
    code: room.code, hostId: room.hostId, inviteUrl: `${gameOrigin}/?room=${room.code}`, phase: room.phase, round: room.round,
    startingHealth: room.startingHealth, roundLimit: room.roundLimit, unitSystem: room.unitSystem, deadline: room.deadline, current: room.current ? {
      id: room.current.id, name: room.current.name, kind: room.current.kind, icon: room.current.icon,
      range: room.current.range, sliderMin: 1, note: answerVisible ? room.current.note : undefined, source: answerVisible ? room.current.source : undefined,
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
  dailyScoreStore = previous?.day === day && previous?.questionId === questionId && previous.participants && typeof previous.participants === 'object'
    ? { day, questionId, participants: previous.participants }
    : { day, questionId, participants: {} };
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
          return dailyScoreSummary(day, participantHash(day, participantId));
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
    const hash = participantHash(day, participantId);
    const operation = dailyScoreWrites.then(async () => {
      const store = await loadDailyScoreStore(day, question.id);
      if (Object.hasOwn(store.participants, hash)) return;
      dailyScoreStore = { day, questionId: question.id, participants: { ...store.participants, [hash]: accuracy } };
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
      const name = String(data.name || '').trim().slice(0, 18);
      if (!name) return send(res, 400, { error: 'Enter a name to create a room.' });
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
      const name = String(data.name || '').trim().slice(0, 18);
      if (!name) return send(res, 400, { error: 'Enter a name to join.' });
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
  try { requested = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)); }
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
