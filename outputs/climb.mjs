import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';

export const CLIMB_ROUNDS = 10;
const MAX_SPEED_RATIO = 3;
const ALGORITHM_VERSION = 'mountain-v2';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;

export class ClimbError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ClimbError';
    this.status = status;
  }
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function seededRandom(seed) {
  let state = Number.parseInt(hash(seed).slice(0, 8), 16);
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function comparable(first, second) {
  return first.speed !== second.speed && Math.max(first.speed, second.speed) / Math.min(first.speed, second.speed) <= MAX_SPEED_RATIO;
}

function questionSnapshot(question, describe) {
  return {
    id: String(question.id), name: String(question.name), kind: String(question.kind || 'OBJECT'),
    blurb: describe(question.note), speed: Number(question.speed),
    imagePath: String(question.imagePath || ''), imageSourceUrl: String(question.imageSourceUrl || ''),
    imageCredit: String(question.imageCredit || ''), imageLicenseUrl: String(question.imageLicenseUrl || ''),
    source: String(question.source || ''), secondarySource: String(question.secondarySource || ''),
  };
}

function matchupCycle(day, candidates, cycle, offset = 0) {
  const random = seededRandom(`${ALGORITHM_VERSION}:${day}:${cycle}`);
  const edges = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (comparable(candidates[i], candidates[j])) edges.push([candidates[i], candidates[j]]);
    }
  }
  const used = new Set();
  const pairs = [];
  for (const objects of shuffled(edges, random)) {
    if (objects.some(item => used.has(item.id))) continue;
    objects.forEach(item => used.add(item.id));
    const ordered = shuffled(objects, random);
    pairs.push({ id: hash(`${ALGORITHM_VERSION}:${day}:${offset + pairs.length}:${ordered.map(item => `${item.id}:${item.speed}`).join(':')}`).slice(0, 24), objects: ordered });
  }
  return pairs;
}

export function generateClimbChallenge(day, deck, describe = () => '') {
  const seenIds = new Set();
  const seenNames = new Set();
  const candidates = deck
    .filter(item => item && item.id && item.name && Number.isFinite(Number(item.speed)) && Number(item.speed) >= 1)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'))
    .filter(item => {
      const name = String(item.name).trim().toLowerCase();
      if (seenIds.has(String(item.id)) || seenNames.has(name)) return false;
      seenIds.add(String(item.id));
      seenNames.add(name);
      return true;
    })
    .map(item => questionSnapshot(item, describe));
  const pairs = matchupCycle(day, candidates, 0);
  if (pairs.length < CLIMB_ROUNDS) throw new Error('The speed library needs 20 distinct objects with comparable, different speeds for the daily climb.');
  return {
    day,
    id: hash(`${ALGORITHM_VERSION}:${day}:${candidates.map(item => `${item.id}:${item.speed}`).join(':')}`).slice(0, 24),
    algorithmVersion: ALGORITHM_VERSION, pairs, deck: candidates, nextCycle: 1,
  };
}

function ensureMatchup(challenge, index) {
  if (challenge.pairs[index]) return false;
  const more = matchupCycle(challenge.day, challenge.deck, challenge.nextCycle, challenge.pairs.length);
  if (!more.length) throw new Error('Could not prepare another comparable matchup.');
  challenge.pairs.push(...more);
  challenge.nextCycle += 1;
  return true;
}

function publicObject(object, reveal = false) {
  const { id, name, kind, blurb, imagePath, imageSourceUrl, imageCredit, imageLicenseUrl } = object;
  const result = { id, name, kind, blurb, imagePath, imageSourceUrl, imageCredit, imageLicenseUrl };
  if (reveal) Object.assign(result, { speed: object.speed, source: object.source, secondarySource: object.secondarySource });
  return result;
}

function participantKey(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new ClimbError(400, 'Could not load your player profile. Reload the page and try again.');
  return hash(`profile:${value.toLowerCase()}`);
}

function defaultPlayer() {
  return { currentStreak: 0, bestStreak: 0, lastSummitDay: null, totalClimbs: 0, totalSummits: 0, bestLevel: 0, day: null, challengeId: null, answers: [] };
}

function levelFor(player) {
  return player.answers.filter(answer => answer.correct).length;
}

function streakFor(player, day) {
  if (!player.lastSummitDay) return 0;
  const elapsed = (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${player.lastSummitDay}T00:00:00Z`)) / DAY_MS;
  return elapsed >= 0 && elapsed <= 1 ? player.currentStreak : 0;
}

function resultFor(answer, challenge) {
  if (!answer) return null;
  const pair = challenge.pairs[answer.index];
  return {
    pairId: pair.id, round: answer.index + 1, choiceId: answer.choiceId,
    correctId: pair.objects[0].speed > pair.objects[1].speed ? pair.objects[0].id : pair.objects[1].id,
    correct: answer.correct, objects: pair.objects.map(object => publicObject(object, true)),
    level: answer.level, attempts: answer.index + 1, answeredAt: answer.answeredAt,
  };
}

function publicState(player, challenge) {
  const attempts = player.answers.length;
  const level = levelFor(player);
  const completed = level === CLIMB_ROUNDS;
  const pair = completed ? null : challenge.pairs[attempts];
  return {
    day: challenge.day, challengeId: challenge.id, level, attempts, total: CLIMB_ROUNDS,
    completed, summit: completed, score: completed ? attempts : null, perfect: completed && attempts === CLIMB_ROUNDS,
    streak: streakFor(player, challenge.day), bestStreak: player.bestStreak,
    nextResetAt: new Date(Date.parse(`${challenge.day}T00:00:00Z`) + DAY_MS).toISOString(),
    pair: pair ? { id: pair.id, objects: pair.objects.map(object => publicObject(object)) } : null,
    lastResult: resultFor(player.answers.at(-1), challenge),
    results: player.answers.map(answer => ({ correct: answer.correct, choiceId: answer.choiceId, pairId: challenge.pairs[answer.index].id })),
    stats: { bestLevel: player.bestLevel, climbs: player.totalClimbs, summits: player.totalSummits },
  };
}

export function createClimbEngine({ deck, dataDir, now = () => new Date(), describe = () => '' }) {
  const dataFile = path.join(dataDir, 'climb-progress.json');
  let store;
  let operations = Promise.resolve();

  async function load() {
    if (store) return store;
    try {
      const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
      if (parsed?.version !== 1 || !parsed.players || typeof parsed.players !== 'object' || Array.isArray(parsed.players)) throw new Error('Invalid climb progress file.');
      store = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      store = { version: 1, challenge: null, players: {} };
    }
    return store;
  }

  async function persist(nextStore) {
    await mkdir(dataDir, { recursive: true });
    const temporaryFile = `${dataFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryFile, JSON.stringify(nextStore), { encoding: 'utf8', mode: 0o600 });
      await rename(temporaryFile, dataFile);
    } catch (error) {
      await unlink(temporaryFile).catch(() => {});
      throw error;
    }
    store = nextStore;
  }

  function serialized(operation) {
    const pending = operations.then(operation);
    operations = pending.catch(() => {});
    return pending;
  }

  async function prepare(key) {
    const previous = await load();
    const next = structuredClone(previous);
    const day = new Date(now()).toISOString().slice(0, 10);
    let changed = false;
    if (next.challenge?.day !== day || next.challenge.algorithmVersion !== ALGORITHM_VERSION) {
      next.challenge = generateClimbChallenge(day, deck, describe);
      changed = true;
    }
    let player = next.players[key];
    if (!player) {
      player = defaultPlayer();
      next.players[key] = player;
      changed = true;
    }
    if (player.day !== day || player.challengeId !== next.challenge.id) {
      player.day = day;
      player.challengeId = next.challenge.id;
      player.answers = [];
      changed = true;
    }
    if (levelFor(player) < CLIMB_ROUNDS && ensureMatchup(next.challenge, player.answers.length)) changed = true;
    return { next, player, challenge: next.challenge, changed };
  }

  return {
    async get(participantId) {
      const key = participantKey(participantId);
      return serialized(async () => {
        const { next, player, challenge, changed } = await prepare(key);
        if (changed) await persist(next);
        return publicState(player, challenge);
      });
    },
    async answer(data) {
      const key = participantKey(data?.participantId);
      return serialized(async () => {
        const { next, player, challenge } = await prepare(key);
        if (data.day !== challenge.day) throw new ClimbError(409, 'A new daily climb has started. Reload to begin today’s mountain.');
        if (data.challengeId !== challenge.id) throw new ClimbError(409, 'This challenge has changed. Reload the page to continue.');
        if (levelFor(player) >= CLIMB_ROUNDS) throw new ClimbError(409, 'You have reached today’s summit. A new mountain arrives tomorrow.');
        const pair = challenge.pairs[player.answers.length];
        if (data.pairId !== pair.id) throw new ClimbError(409, 'That matchup has already been answered or is out of date. Refresh your climb to continue.');
        if (!pair.objects.some(object => object.id === data.choiceId)) throw new ClimbError(400, 'Choose one of the two objects in this matchup.');
        const faster = pair.objects[0].speed > pair.objects[1].speed ? pair.objects[0] : pair.objects[1];
        const correct = data.choiceId === faster.id;
        const level = levelFor(player) + Number(correct);
        if (player.answers.length === 0) player.totalClimbs += 1;
        player.answers.push({ index: player.answers.length, choiceId: data.choiceId, correct, level, answeredAt: new Date(now()).toISOString() });
        player.bestLevel = Math.max(player.bestLevel, level);
        if (level === CLIMB_ROUNDS) {
          const previousDay = new Date(Date.parse(`${challenge.day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
          player.currentStreak = player.lastSummitDay === previousDay ? player.currentStreak + 1 : 1;
          player.bestStreak = Math.max(player.bestStreak, player.currentStreak);
          player.lastSummitDay = challenge.day;
          player.totalSummits += 1;
        }
        if (level < CLIMB_ROUNDS) ensureMatchup(challenge, player.answers.length);
        await persist(next);
        return publicState(player, challenge);
      });
    },
  };
}
