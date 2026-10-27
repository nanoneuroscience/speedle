import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createClimbEngine, generateClimbChallenge } from './climb.mjs';

const deck = JSON.parse(await readFile(new URL('./public/daily-deck.json', import.meta.url), 'utf8'));
const firstPlayer = '00000000-0000-4000-8000-000000000001';
const secondPlayer = '00000000-0000-4000-8000-000000000002';

async function fixture(t, initialDate = '2026-10-27T12:00:00Z') {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'speedle-climb-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  let date = new Date(initialDate);
  const options = { deck, dataDir, now: () => date, describe: () => 'A short description.' };
  return { dataDir, options, engine: createClimbEngine(options), setDate: value => { date = new Date(value); } };
}

function submission(state, choiceId, participantId = firstPlayer) {
  return { participantId, day: state.day, challengeId: state.challengeId, pairId: state.pair.id, choiceId };
}

function winner(state) {
  const [first, second] = state.pair.objects.map(object => deck.find(question => question.id === object.id));
  return first.speed > second.speed ? first.id : second.id;
}

async function complete(engine, participantId = firstPlayer) {
  let state = await engine.get(participantId);
  while (!state.completed) state = await engine.answer(submission(state, winner(state), participantId));
  return state;
}

test('daily matchups are reproducible, comparable, distinct, and exclude equal speeds', () => {
  const challenge = generateClimbChallenge('2026-10-27', deck);
  assert.deepEqual(challenge, generateClimbChallenge('2026-10-27', [...deck].reverse()));
  assert.deepEqual(challenge, generateClimbChallenge('2026-10-27', [...deck, { id: 'too-slow', name: 'Too slow', speed: 0.5 }]));
  assert.throws(() => generateClimbChallenge('2026-10-27', deck.map(question => ({ ...question, speed: 20 }))), /comparable, different speeds/);
  assert.notEqual(challenge.id, generateClimbChallenge('2026-10-28', deck).id);
  for (let offset = 0; offset < 60; offset += 1) {
    const day = new Date(Date.parse('2026-10-27T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
    const daily = generateClimbChallenge(day, deck);
    assert.ok(daily.pairs.length >= 10);
    const objects = daily.pairs.flatMap(pair => pair.objects);
    assert.equal(new Set(objects.map(object => object.id)).size, objects.length);
    assert.equal(new Set(objects.map(object => object.name.toLowerCase())).size, objects.length);
    for (const pair of daily.pairs) {
      const [first, second] = pair.objects;
      assert.ok(first.speed >= 1 && second.speed >= 1);
      assert.notEqual(first.speed, second.speed);
      assert.ok(Math.max(first.speed, second.speed) / Math.min(first.speed, second.speed) <= 3);
    }
  }
});

test('players get the same daily sequence and unrevealed responses contain only safe metadata', async t => {
  const { engine } = await fixture(t);
  const state = await engine.get(firstPlayer);
  const other = await engine.get(secondPlayer);
  assert.equal(state.challengeId, other.challengeId);
  assert.deepEqual(state.pair, other.pair);
  assert.equal(state.nextResetAt, '2026-10-28T00:00:00.000Z');
  assert.equal(state.attempts, 0);
  assert.equal(state.lastResult, null);
  assert.deepEqual(state.results, []);
  for (const object of state.pair.objects) {
    assert.deepEqual(Object.keys(object).sort(), ['id', 'name', 'kind', 'blurb', 'imagePath', 'imageSourceUrl', 'imageCredit', 'imageLicenseUrl'].sort());
    assert.equal(object.blurb, 'A short description.');
  }
  const firstAnswer = await engine.answer(submission(state, winner(state)));
  assert.equal(firstAnswer.level, 1);
  assert.equal(firstAnswer.attempts, 1);
  assert.equal(firstAnswer.lastResult.correct, true);
  assert.equal(firstAnswer.lastResult.pairId, state.pair.id);
  assert.deepEqual(firstAnswer.results, [{ correct: true, choiceId: winner(state), pairId: state.pair.id }]);
  assert.ok(firstAnswer.lastResult.objects.every(object => Number.isFinite(object.speed)));
  assert.ok(firstAnswer.pair.objects.every(object => !Object.hasOwn(object, 'speed')));
  const otherAnswer = await engine.answer(submission(other, winner(other), secondPlayer));
  assert.deepEqual(firstAnswer.pair, otherAnswer.pair);
});

test('answer progress and the chosen question snapshots survive restarts and deck changes', async t => {
  const { engine, options } = await fixture(t);
  const initial = await engine.get(firstPlayer);
  const answered = await engine.answer(submission(initial, winner(initial)));
  const updatedDeck = deck.map(question => ({ ...question, speed: question.speed * 10, name: `Changed ${question.name}` }));
  const restarted = createClimbEngine({ ...options, deck: updatedDeck });
  const restored = await restarted.get(firstPlayer);
  assert.deepEqual(restored, answered);
  assert.deepEqual((await restarted.get(secondPlayer)).pair, initial.pair);
});

test('wrong answers hold the level and ten correct answers complete the climb with attempts as the score', async t => {
  const { engine } = await fixture(t);
  let state = await engine.get(firstPlayer);
  for (let i = 0; i < 3; i += 1) {
    const incorrect = state.pair.objects.find(object => object.id !== winner(state)).id;
    state = await engine.answer(submission(state, incorrect));
    assert.equal(state.level, 0);
    assert.equal(state.attempts, i + 1);
    assert.equal(state.lastResult.correct, false);
  }
  for (let i = 0; i < 9; i += 1) state = await engine.answer(submission(state, winner(state)));
  assert.equal(state.level, 9);
  assert.equal(state.attempts, 12);
  assert.equal(state.completed, false);
  assert.ok(state.pair);
  assert.equal(state.score, null);
  assert.equal(state.perfect, false);
  state = await engine.answer(submission(state, winner(state)));
  assert.equal(state.level, 10);
  assert.equal(state.attempts, 13);
  assert.equal(state.completed, true);
  assert.equal(state.summit, true);
  assert.equal(state.score, 13);
  assert.equal(state.perfect, false);
  assert.equal(state.pair, null);
  assert.deepEqual(state.stats, { bestLevel: 10, climbs: 1, summits: 1 });
  await assert.rejects(engine.answer({ participantId: firstPlayer, day: state.day, challengeId: state.challengeId }), error => error.status === 409);
});

test('the deterministic sequence continues beyond the pool and resets only after unused objects are exhausted', async t => {
  const { options } = await fixture(t);
  const smallDeck = Array.from({ length: 20 }, (_, index) => ({ id: `object-${index}`, name: `Object ${index}`, speed: index + 10 }));
  const engine = createClimbEngine({ ...options, deck: smallDeck });
  let state = await engine.get(firstPlayer);
  let other = await engine.get(secondPlayer);
  const challengeId = state.challengeId;
  const used = new Set();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    assert.deepEqual(state.pair, other.pair);
    assert.equal(state.challengeId, challengeId);
    if (attempt % 10 === 0) used.clear();
    for (const object of state.pair.objects) {
      assert.ok(!used.has(object.id));
      used.add(object.id);
    }
    const objects = state.pair.objects.map(object => smallDeck.find(question => question.id === object.id));
    const slower = objects[0].speed < objects[1].speed ? objects[0] : objects[1];
    state = await engine.answer(submission(state, slower.id));
    other = await engine.answer(submission(other, slower.id, secondPlayer));
  }
  assert.equal(state.attempts, 25);
  assert.equal(state.level, 0);
  assert.equal(state.completed, false);
  assert.ok(state.pair);
  const restored = await createClimbEngine({ ...options, deck: [] }).get(firstPlayer);
  assert.deepEqual(restored, state);
});

test('duplicate, concurrent, tampered, future and stale submissions cannot advance progress', async t => {
  const { engine, setDate } = await fixture(t);
  const initial = await engine.get(firstPlayer);
  const data = submission(initial, winner(initial));
  await assert.rejects(engine.answer({ ...data, choiceId: 'not-an-option' }), error => error.status === 400);
  await assert.rejects(engine.answer({ ...data, challengeId: 'different-challenge' }), error => error.status === 409);
  await assert.rejects(engine.answer({ ...data, pairId: 'future-matchup' }), error => error.status === 409);
  await assert.rejects(engine.get('not-a-uuid'), error => error.status === 400);
  assert.equal((await engine.get(firstPlayer)).attempts, 0);
  const results = await Promise.allSettled([engine.answer(data), engine.answer(data)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  assert.equal((await engine.get(firstPlayer)).attempts, 1);
  await assert.rejects(engine.answer(data), error => error.status === 409);
  setDate('2026-10-28T00:00:00Z');
  await assert.rejects(engine.answer(data), error => error.status === 409);
  assert.equal((await engine.get(firstPlayer)).attempts, 0);
});

test('summit streaks require ten correct answers, survive restarts, and reset after a missed day', async t => {
  const { engine, options, setDate } = await fixture(t);
  let result = await complete(engine);
  assert.equal(result.summit, true);
  assert.equal(result.score, 10);
  assert.equal(result.perfect, true);
  assert.equal(result.streak, 1);
  assert.equal(result.bestStreak, 1);
  setDate('2026-10-28T12:00:00Z');
  const restarted = createClimbEngine(options);
  result = await complete(restarted);
  assert.equal(result.streak, 2);
  assert.equal(result.bestStreak, 2);
  assert.equal(result.stats.summits, 2);
  setDate('2026-10-30T12:00:00Z');
  assert.equal((await restarted.get(firstPlayer)).streak, 0);
  result = await complete(restarted);
  assert.equal(result.streak, 1);
  assert.equal(result.bestStreak, 2);
  assert.equal(result.stats.climbs, 3);
  assert.equal(result.stats.summits, 3);
});

test('a failed disk write neither acknowledges nor advances an answer', async t => {
  const { engine, dataDir } = await fixture(t);
  const state = await engine.get(firstPlayer);
  const data = submission(state, winner(state));
  const backup = `${dataDir}-backup`;
  await rename(dataDir, backup);
  await writeFile(dataDir, 'This file deliberately blocks the data directory.');
  try {
    await assert.rejects(engine.answer(data));
  } finally {
    await rm(dataDir);
    await rename(backup, dataDir);
  }
  assert.equal((await engine.get(firstPlayer)).attempts, 0);
  const saved = await engine.answer(data);
  assert.equal(saved.attempts, 1);
  assert.equal(saved.level, 1);
});

test('the climb leaves legacy daily, profile, and endless storage intact', async t => {
  const { engine, dataDir } = await fixture(t);
  const legacyFile = path.join(dataDir, 'daily-scores.json');
  const legacy = JSON.stringify({ version: 2, profiles: { existing: { displayName: 'Keep me', bestStreak: 8 } }, participants: { existing: 94 }, endlessScores: { existing: 23 } });
  await writeFile(legacyFile, legacy);
  await complete(engine);
  assert.equal(await readFile(legacyFile, 'utf8'), legacy);
});

test('unreadable progress is reported without replacing saved data', async t => {
  const { options, dataDir } = await fixture(t);
  const progressFile = path.join(dataDir, 'climb-progress.json');
  await writeFile(progressFile, 'invalid saved progress');
  const restarted = createClimbEngine(options);
  await assert.rejects(restarted.get(firstPlayer));
  assert.equal(await readFile(progressFile, 'utf8'), 'invalid saved progress');
});
