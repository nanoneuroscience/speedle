import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const rooms = new Map();
const streams = new Map();
const scoreDataDir = process.env.SPEEDLE_DATA_DIR || path.join(os.tmpdir(), 'speedle-data');
const scoreDataFile = path.join(scoreDataDir, 'daily-scores.json');
let dailyScoreStore = null;
let dailyScoreStoreDay = null;
let dailyScoreWrites = Promise.resolve();
const lanAddress = Object.values(os.networkInterfaces()).flat().find(x => x && x.family === 'IPv4' && !x.internal)?.address || 'localhost';
const configuredGameOrigin = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
const gameOrigin = (configuredGameOrigin || `http://${lanAddress}:${PORT}`).replace(/\/+$/, '');
const dailyDeck = JSON.parse(await readFile(path.join(here, 'public', 'daily-deck.json'), 'utf8'));
if (!Array.isArray(dailyDeck) || !dailyDeck.length) throw new Error('The daily question deck is empty.');

const deck = [
  { name: 'Peregrine falcon', kind: 'ANIMAL · BIRD', icon: '🦅', speed: 240, range: 300, note: 'In a hunting dive, a peregrine falcon can reach extraordinary speeds.' },
  { name: 'Cheetah', kind: 'ANIMAL · LAND', icon: '🐆', speed: 70, range: 120, note: 'The fastest land animal over short distances.' },
  { name: 'Sailfish', kind: 'ANIMAL · OCEAN', icon: '🐟', speed: 68, range: 120, note: 'Often cited among the ocean’s fastest swimmers.' },
  { name: 'Ostrich', kind: 'ANIMAL · BIRD', icon: '🦤', speed: 43, range: 80, note: 'The world’s largest living bird is also a very fast runner.' },
  { name: 'House cat', kind: 'ANIMAL · LAND', icon: '🐈', speed: 30, range: 60, note: 'A sprinting house cat can briefly outrun most people.' },
  { name: 'Usain Bolt', kind: 'HUMAN · SPRINTER', icon: '🏃', speed: 28, range: 60, note: 'His peak speed during the 100 m world-record run.' },
  { name: 'Road bicycle', kind: 'OBJECT · HUMAN POWER', icon: '🚴', speed: 60, range: 120, note: 'A top-level sprint on a flat road can reach this neighborhood.' },
  { name: 'Formula 1 car', kind: 'OBJECT · MOTORSPORT', icon: '🏎️', speed: 230, range: 300, note: 'Top speeds vary by circuit, setup, and conditions.' },
  { name: 'Boeing 747', kind: 'OBJECT · AIRCRAFT', icon: '✈️', speed: 614, range: 800, note: 'Approximate cruising speed at altitude.' },
  { name: 'Blue whale', kind: 'ANIMAL · OCEAN', icon: '🐋', speed: 31, range: 60, note: 'A blue whale can move surprisingly quickly for its size.' },
  { name: 'Greyhound', kind: 'ANIMAL · LAND', icon: '🐕', speed: 45, range: 80, note: 'Built for acceleration and short, fast runs.' },
  { name: 'Bullet train', kind: 'OBJECT · RAIL', icon: '🚄', speed: 200, range: 300, note: 'A representative high-speed service speed.' },
  // More animals
  { name: 'Pronghorn', kind: 'ANIMAL · LAND', icon: '🦌', speed: 60, range: 90, note: 'North America’s fastest land mammal can reach this speed.' },
  { name: 'Lioness', kind: 'ANIMAL · LAND', icon: '🦁', speed: 33, range: 70, note: 'A short sprint can reach about this speed.' },
  { name: 'Tiger', kind: 'ANIMAL · LAND', icon: '🐅', speed: 40, range: 70, note: 'A tiger can sprint quickly over short distances.' },
  { name: 'African elephant', kind: 'ANIMAL · LAND', icon: '🐘', speed: 25, range: 60, note: 'Elephants can move into a surprisingly brisk charge.' },
  { name: 'Giraffe', kind: 'ANIMAL · LAND', icon: '🦒', speed: 35, range: 70, note: 'A running giraffe can briefly reach this speed.' },
  { name: 'Thoroughbred horse', kind: 'ANIMAL · LAND', icon: '🐎', speed: 55, range: 90, note: 'A racehorse can reach this speed in a sprint.' },
  { name: 'Dromedary camel', kind: 'ANIMAL · LAND', icon: '🐪', speed: 40, range: 80, note: 'A racing camel can reach this speed over a short stretch.' },
  { name: 'Red kangaroo', kind: 'ANIMAL · LAND', icon: '🦘', speed: 44, range: 80, note: 'Its powerful hind legs can propel it in long bounds.' },
  { name: 'Wildebeest', kind: 'ANIMAL · LAND', icon: '🦬', speed: 50, range: 90, note: 'Wildebeest rely on speed to escape predators on open plains.' },
  { name: 'Plains zebra', kind: 'ANIMAL · LAND', icon: '🦓', speed: 40, range: 80, note: 'A zebra can sprint quickly when fleeing danger.' },
  { name: 'Elk', kind: 'ANIMAL · LAND', icon: '🫎', speed: 45, range: 80, note: 'Despite their size, elk are capable runners.' },
  { name: 'Reindeer', kind: 'ANIMAL · LAND', icon: '🦌', speed: 50, range: 90, note: 'Reindeer can cover ground quickly while migrating.' },
  { name: 'Coyote', kind: 'ANIMAL · LAND', icon: '🐺', speed: 43, range: 80, note: 'Coyotes can accelerate into a fast short sprint.' },
  { name: 'Gray wolf', kind: 'ANIMAL · LAND', icon: '🐺', speed: 38, range: 70, note: 'Wolves combine short bursts with long-distance travel.' },
  { name: 'Brown bear', kind: 'ANIMAL · LAND', icon: '🐻', speed: 35, range: 70, note: 'A bear can run much faster than its bulky build suggests.' },
  { name: 'Polar bear', kind: 'ANIMAL · LAND', icon: '🐻‍❄️', speed: 25, range: 60, note: 'Polar bears can sprint over short distances on land.' },
  { name: 'Cottontail rabbit', kind: 'ANIMAL · LAND', icon: '🐇', speed: 25, range: 60, note: 'A rabbit’s quick zigzag sprint helps it escape predators.' },
  { name: 'Black-tailed jackrabbit', kind: 'ANIMAL · LAND', icon: '🐇', speed: 45, range: 80, note: 'Long legs help this hare-like runner escape across open ground.' },
  { name: 'Hippopotamus', kind: 'ANIMAL · LAND', icon: '🦛', speed: 19, range: 50, note: 'Hippos can charge quickly despite their massive size.' },
  { name: 'White rhinoceros', kind: 'ANIMAL · LAND', icon: '🦏', speed: 31, range: 60, note: 'A charging rhino can move at a fast running pace.' },
  { name: 'Gorilla', kind: 'ANIMAL · LAND', icon: '🦍', speed: 20, range: 50, note: 'A gorilla can run in a short burst when moving quickly.' },
  { name: 'Chimpanzee', kind: 'ANIMAL · LAND', icon: '🐒', speed: 25, range: 60, note: 'On the ground, a chimpanzee can sprint on all fours.' },
  { name: 'Patas monkey', kind: 'ANIMAL · LAND', icon: '🐒', speed: 34, range: 70, note: 'This ground-dwelling primate is one of the fastest monkeys.' },
  { name: 'Impala', kind: 'ANIMAL · LAND', icon: '🦌', speed: 55, range: 90, note: 'Impala use fast sprints and leaps to evade predators.' },
  { name: 'Springbok', kind: 'ANIMAL · LAND', icon: '🦌', speed: 55, range: 90, note: 'This antelope can sprint and make high bouncing leaps.' },
  { name: 'Goitered gazelle', kind: 'ANIMAL · LAND', icon: '🦌', speed: 60, range: 100, note: 'A recorded top speed for this gazelle is around 60 mph.' },
  { name: 'Mule deer', kind: 'ANIMAL · LAND', icon: '🦌', speed: 35, range: 70, note: 'Mule deer can bound away from danger at a quick pace.' },
  { name: 'Golden eagle (dive)', kind: 'ANIMAL · BIRD', icon: '🦅', speed: 150, range: 250, note: 'A diving eagle can travel far faster than it flies level.' },
  { name: 'Red-tailed hawk (dive)', kind: 'ANIMAL · BIRD', icon: '🦅', speed: 120, range: 200, note: 'This is a short diving speed, not its everyday flight pace.' },
  { name: 'Common swift', kind: 'ANIMAL · BIRD', icon: '🐦', speed: 70, range: 120, note: 'A swift can maintain a fast pace in level flight.' },
  { name: 'Ruby-throated hummingbird', kind: 'ANIMAL · BIRD', icon: '🐦', speed: 30, range: 60, note: 'This is a typical fast flight pace; courtship dives are quicker.' },
  { name: 'Mallard duck (flight)', kind: 'ANIMAL · BIRD', icon: '🦆', speed: 55, range: 100, note: 'Mallards can fly at this speed when moving quickly.' },
  { name: 'Homing pigeon', kind: 'ANIMAL · BIRD', icon: '🕊️', speed: 90, range: 150, note: 'Racing pigeons can reach this speed in favorable conditions.' },
  { name: 'Osprey (dive)', kind: 'ANIMAL · BIRD', icon: '🦅', speed: 80, range: 150, note: 'An osprey folds into a steep dive when targeting fish.' },
  { name: 'Emu', kind: 'ANIMAL · BIRD', icon: '🐦', speed: 31, range: 60, note: 'The second-tallest living bird is a strong runner.' },
  { name: 'Swordfish', kind: 'ANIMAL · OCEAN', icon: '🐟', speed: 60, range: 100, note: 'Fast-swimming estimates vary, but swordfish are built for bursts.' },
  { name: 'Yellowfin tuna', kind: 'ANIMAL · OCEAN', icon: '🐟', speed: 47, range: 90, note: 'A streamlined body and powerful tail drive quick bursts.' },
  { name: 'Great white shark', kind: 'ANIMAL · OCEAN', icon: '🦈', speed: 25, range: 60, note: 'A great white can accelerate rapidly during a short attack.' },
  { name: 'Shortfin mako shark', kind: 'ANIMAL · OCEAN', icon: '🦈', speed: 46, range: 90, note: 'The shortfin mako is among the ocean’s fastest sharks.' },
  { name: 'Orca', kind: 'ANIMAL · OCEAN', icon: '🐬', speed: 35, range: 70, note: 'Orcas are powerful swimmers that can make fast bursts.' },
  { name: 'Bottlenose dolphin', kind: 'ANIMAL · OCEAN', icon: '🐬', speed: 22, range: 50, note: 'A dolphin can accelerate quickly while chasing prey.' },
  { name: 'California sea lion', kind: 'ANIMAL · OCEAN', icon: '🦭', speed: 18, range: 40, note: 'Sea lions can swim quickly in short bursts.' },
  { name: 'Gentoo penguin', kind: 'ANIMAL · OCEAN', icon: '🐧', speed: 22, range: 50, note: 'Gentoo penguins are among the fastest swimming birds.' },
  // More objects and vehicles
  { name: 'Porsche 911 Turbo S', kind: 'OBJECT · SPORTS CAR', icon: '🏎️', speed: 205, range: 300, note: 'A high-performance road car with a top speed just over 200 mph.' },
  { name: 'Bugatti Chiron Super Sport 300+', kind: 'OBJECT · HYPERCAR', icon: '🏎️', speed: 304, range: 400, note: 'A specially prepared Chiron exceeded 300 mph on a test track.' },
  { name: 'McLaren F1', kind: 'OBJECT · SUPERCAR', icon: '🏎️', speed: 240, range: 350, note: 'The F1 became famous for its record-setting top speed in the 1990s.' },
  { name: 'Lamborghini Aventador SVJ', kind: 'OBJECT · SUPERCAR', icon: '🏎️', speed: 217, range: 300, note: 'A V12 supercar with a top speed above 200 mph.' },
  { name: 'Ferrari SF90 Stradale', kind: 'OBJECT · SUPERCAR', icon: '🏎️', speed: 211, range: 300, note: 'Ferrari’s plug-in hybrid supercar is capable of more than 200 mph.' },
  { name: 'Tesla Model S Plaid', kind: 'OBJECT · ELECTRIC CAR', icon: '🚘', speed: 200, range: 300, note: 'With the right configuration, this electric sedan reaches 200 mph.' },
  { name: 'Dodge Challenger SRT Hellcat Redeye', kind: 'OBJECT · MUSCLE CAR', icon: '🚘', speed: 203, range: 300, note: 'A high-powered muscle car with a claimed top speed above 200 mph.' },
  { name: 'Chevrolet Corvette ZR1', kind: 'OBJECT · SUPERCAR', icon: '🏎️', speed: 233, range: 350, note: 'The latest ZR1 is built for extreme speed on road and track.' },
  { name: 'Ford GT', kind: 'OBJECT · SUPERCAR', icon: '🏎️', speed: 216, range: 300, note: 'This road-going Ford supercar can exceed 200 mph.' },
  { name: 'Nissan GT-R Nismo', kind: 'OBJECT · SPORTS CAR', icon: '🚘', speed: 196, range: 300, note: 'A track-focused version of Nissan’s high-performance coupe.' },
  { name: 'Porsche Taycan Turbo S', kind: 'OBJECT · ELECTRIC CAR', icon: '🚘', speed: 162, range: 250, note: 'A powerful electric sedan with a high top speed for its class.' },
  { name: 'Rimac Nevera', kind: 'OBJECT · ELECTRIC HYPERCAR', icon: '🏎️', speed: 258, range: 350, note: 'This electric hypercar has recorded a top speed above 250 mph.' },
  { name: 'Koenigsegg Agera RS', kind: 'OBJECT · HYPERCAR', icon: '🏎️', speed: 278, range: 400, note: 'The Agera RS set a public-road production-car speed record.' },
  { name: 'Bugatti Veyron Super Sport', kind: 'OBJECT · HYPERCAR', icon: '🏎️', speed: 267, range: 400, note: 'A record-setting production version of the Veyron.' },
  { name: 'Honda Civic Type R', kind: 'OBJECT · SPORTS CAR', icon: '🚘', speed: 169, range: 250, note: 'A front-wheel-drive performance hatchback with a high top speed.' },
  { name: 'Toyota GR Supra', kind: 'OBJECT · SPORTS CAR', icon: '🚘', speed: 155, range: 250, note: 'The production model is electronically limited to around this speed.' },
  { name: 'Jeep Wrangler', kind: 'OBJECT · OFF-ROAD SUV', icon: '🚙', speed: 112, range: 200, note: 'Designed for trails first, its road top speed is much lower than a sports car.' },
  { name: 'ThrustSSC', kind: 'OBJECT · JET-POWERED CAR', icon: '🏎️', speed: 763, range: 1000, note: 'This jet-powered car holds the official outright land-speed record.' },
  { name: 'Concorde', kind: 'OBJECT · AIRCRAFT', icon: '✈️', speed: 1354, range: 1800, note: 'The supersonic passenger jet cruised at more than twice the speed of sound.' },
  { name: 'SR-71 Blackbird', kind: 'OBJECT · AIRCRAFT', icon: '✈️', speed: 2193, range: 3000, note: 'A NASA-recorded flight set a speed record above 2,190 mph.' },
  { name: 'North American X-15', kind: 'OBJECT · ROCKET AIRCRAFT', icon: '🚀', speed: 4520, range: 6000, note: 'This rocket-powered research aircraft set an unofficial record of 4,520 mph.' },
  { name: 'Cessna 172', kind: 'OBJECT · AIRCRAFT', icon: '🛩️', speed: 140, range: 250, note: 'A small single-engine plane with a typical maximum speed near 140 mph.' },
  { name: 'Boeing 787 Dreamliner', kind: 'OBJECT · AIRCRAFT', icon: '✈️', speed: 594, range: 800, note: 'A long-haul airliner designed to cruise close to 600 mph.' },
  { name: 'Airbus A380', kind: 'OBJECT · AIRCRAFT', icon: '✈️', speed: 587, range: 800, note: 'The world’s largest passenger airliner cruises at high subsonic speed.' },
  { name: 'F-16 Fighting Falcon', kind: 'OBJECT · FIGHTER JET', icon: '✈️', speed: 1320, range: 1800, note: 'At altitude, this fighter is capable of reaching about Mach 2.' },
  { name: 'Supermarine Spitfire', kind: 'OBJECT · AIRCRAFT', icon: '✈️', speed: 362, range: 600, note: 'The classic WWII fighter reached this speed in later versions.' },
  { name: 'P-51 Mustang', kind: 'OBJECT · AIRCRAFT', icon: '✈️', speed: 437, range: 700, note: 'A fast WWII fighter known for its long-range escort missions.' },
  { name: 'F/A-18 Super Hornet', kind: 'OBJECT · FIGHTER JET', icon: '✈️', speed: 1190, range: 1800, note: 'This carrier-based fighter can fly at supersonic speed.' },
  { name: 'TGV V150 train', kind: 'OBJECT · RAIL', icon: '🚄', speed: 357, range: 500, note: 'A modified French TGV set the rail-speed record for conventional trains.' },
  { name: 'Shanghai Maglev train', kind: 'OBJECT · RAIL', icon: '🚄', speed: 268, range: 400, note: 'The magnetic-levitation service reaches this speed in operation.' },
  { name: 'L0 Series maglev train', kind: 'OBJECT · RAIL', icon: '🚄', speed: 375, range: 550, note: 'Japan’s superconducting maglev reached this speed during testing.' },
  { name: 'Eurostar e320', kind: 'OBJECT · RAIL', icon: '🚄', speed: 200, range: 300, note: 'This high-speed passenger train can run at about 200 mph.' },
  { name: 'Amtrak Acela', kind: 'OBJECT · RAIL', icon: '🚄', speed: 160, range: 250, note: 'The Acela reaches its highest speeds on select sections of track.' },
  { name: 'ICE 3 train', kind: 'OBJECT · RAIL', icon: '🚄', speed: 205, range: 300, note: 'Germany’s ICE 3 operates at high speeds on upgraded lines.' },
  { name: 'Kawasaki Ninja H2R', kind: 'OBJECT · MOTORCYCLE', icon: '🏍️', speed: 249, range: 350, note: 'A closed-course supercharged motorcycle capable of nearly 250 mph.' },
  { name: 'Suzuki Hayabusa', kind: 'OBJECT · MOTORCYCLE', icon: '🏍️', speed: 186, range: 300, note: 'Modern models are electronically limited to about 186 mph.' },
  { name: 'Ducati Panigale V4 R', kind: 'OBJECT · MOTORCYCLE', icon: '🏍️', speed: 199, range: 300, note: 'A racing-derived superbike that can approach 200 mph.' },
  { name: 'LiveWire One', kind: 'OBJECT · ELECTRIC MOTORCYCLE', icon: '🏍️', speed: 110, range: 200, note: 'A production electric motorcycle with a top speed around 110 mph.' },
  { name: 'Eta human-powered bicycle', kind: 'OBJECT · BICYCLE', icon: '🚴', speed: 90, range: 150, note: 'A streamlined recumbent cycle set a human-powered speed record.' },
  { name: 'Spirit of Australia', kind: 'OBJECT · HYDROPLANE', icon: '🚤', speed: 318, range: 450, note: 'Ken Warby’s jet-powered hydroplane holds the water-speed record.' },
  { name: 'Vestas Sailrocket 2', kind: 'OBJECT · SAILBOAT', icon: '⛵', speed: 75, range: 120, note: 'This wind-powered craft set the outright sailing speed record.' },
  { name: 'America’s Cup foiling sailboat', kind: 'OBJECT · SAILBOAT', icon: '⛵', speed: 55, range: 100, note: 'Modern foiling race boats can fly above the water at high speed.' },
  { name: 'Personal watercraft', kind: 'OBJECT · WATERCRAFT', icon: '🛥️', speed: 67, range: 120, note: 'Many high-performance models are electronically limited near this speed.' },
  { name: 'Space Shuttle in orbit', kind: 'OBJECT · SPACECRAFT', icon: '🚀', speed: 17500, range: 25000, note: 'The shuttle traveled at orbital speed while circling Earth.' },
  { name: 'Parker Solar Probe', kind: 'OBJECT · SPACECRAFT', icon: '🛰️', speed: 430000, range: 500000, note: 'Near the Sun, NASA’s probe became the fastest human-made object.' },
];

function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function safeRoom(room) {
  return {
    code: room.code, hostId: room.hostId, inviteUrl: `${gameOrigin}/?room=${room.code}`, phase: room.phase, round: room.round,
    startingHealth: room.startingHealth, roundLimit: room.roundLimit, unitSystem: room.unitSystem, deadline: room.deadline, current: room.current ? { name: room.current.name, kind: room.current.kind, icon: room.current.icon, range: room.current.range, note: room.current.note, speed: room.phase === 'reveal' || room.phase === 'finished' ? room.current.speed : undefined } : null,
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
function participantHash(day, id) {
  return createHash('sha256').update(`${day}:${id}`).digest('hex');
}
async function persistDailyScoreStore() {
  await mkdir(scoreDataDir, { recursive: true });
  const temporaryFile = `${scoreDataFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(dailyScoreStore), { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryFile, scoreDataFile);
}
async function loadDailyScoreStore(day) {
  if (dailyScoreStoreDay === day && dailyScoreStore) return dailyScoreStore;
  let previous = null;
  try { previous = JSON.parse(await readFile(scoreDataFile, 'utf8')); } catch {}
  dailyScoreStore = previous?.day === day && previous.participants && typeof previous.participants === 'object'
    ? { day, participants: previous.participants }
    : { day, participants: {} };
  dailyScoreStoreDay = day;
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
  return { day, myAccuracy: currentScore, playerCount: others.length, averageAccuracy, percentile, buckets };
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
function resolveRound(room, timedOut = false) {
  if (room.phase !== 'guessing') return;
  room.phase = 'reveal';
  room.deadline = null;
  for (const p of room.players.values()) {
    if (p.health <= 0) continue;
    if (p.guess == null && timedOut) p.damage = 100;
    else if (p.guess != null) p.damage = Math.min(100, Math.round(100 * Math.abs(p.guess - room.current.speed) / room.current.range));
    else p.damage = null;
    if (p.damage != null) p.health = Math.max(0, p.health - p.damage);
  }
  const alive = [...room.players.values()].filter(p => p.health > 0);
  if (alive.length === 1) { room.phase = 'finished'; room.winner = alive[0]; }
  publish(room);
}
function beginRound(room) {
  const options = deck.filter(q => q.name !== room.previousQuestion);
  room.current = options[Math.floor(Math.random() * options.length)];
  room.previousQuestion = room.current.name;
  room.round += 1;
  room.phase = 'guessing';
  room.deadline = Date.now() + room.roundLimit * 1000;
  for (const p of room.players.values()) { p.guess = null; p.damage = null; }
  publish(room);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  if (url.pathname === '/api/events' && req.method === 'GET') {
    const code = (url.searchParams.get('room') || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'Room not found.' });
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
          await loadDailyScoreStore(day);
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
    if (!Number.isFinite(guess) || guess < 0 || guess > question.range) return send(res, 400, { error: 'Choose a speed within today’s range.' });
    const accuracy = 100 - Math.min(100, Math.round(100 * Math.abs(guess - question.speed) / question.range));
    const hash = participantHash(day, participantId);
    const operation = dailyScoreWrites.then(async () => {
      const store = await loadDailyScoreStore(day);
      if (Object.hasOwn(store.participants, hash)) return;
      dailyScoreStore = { day, participants: { ...store.participants, [hash]: accuracy } };
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
      const room = { code, hostId: id, players: new Map([[id, { id, name, health: 500, connected: true, guess: null, damage: null }]]), phase: 'lobby', round: 0, startingHealth: 500, roundLimit: 30, unitSystem: 'imperial', deadline: null, current: null, previousQuestion: null, winner: null };
      rooms.set(code, room); return send(res, 200, { playerId: id, room: safeRoom(room) });
    }
    const code = String(data.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: 'That room code was not found.' });
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
      beginRound(room); return send(res, 200, { room: safeRoom(room) });
    }
    if (action === 'settings') {
      if (player.id !== room.hostId) return send(res, 403, { error: 'Only the host can change game settings.' });
      if (room.phase !== 'lobby') return send(res, 409, { error: 'Game settings can only be changed in the lobby.' });
      const startingHealth = Number(data.startingHealth);
      const roundLimit = Number(data.roundLimit);
      const unitSystem = String(data.unitSystem || '');
      if (![100, 300, 500].includes(startingHealth)) return send(res, 400, { error: 'Choose 100, 300, or 500 starting HP.' });
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
      const guessRange = room.unitSystem === 'metric' ? Math.round(room.current.range * 1.609344) : room.current.range;
      if (!Number.isFinite(guess) || guess < 0 || guess > guessRange) return send(res, 400, { error: 'Choose a speed within the slider.' });
      player.guess = Number((room.unitSystem === 'metric' ? guess / 1.609344 : guess).toFixed(3)); publish(room);
      const active = [...room.players.values()].filter(p => p.health > 0);
      if (active.every(p => p.guess != null)) resolveRound(room);
      return send(res, 200, { room: safeRoom(room) });
    }
    if (action === 'next') {
      if (player.id !== room.hostId) return send(res, 403, { error: 'Only the host can continue.' });
      if (room.phase !== 'reveal') return send(res, 409, { error: 'The round is still in progress.' });
      beginRound(room); return send(res, 200, { room: safeRoom(room) });
    }
    if (action === 'replay') {
      if (player.id !== room.hostId) return send(res, 403, { error: 'Only the host can start another game.' });
      if (room.phase !== 'finished') return send(res, 409, { error: 'This game has not finished yet.' });
      room.phase = 'lobby';
      room.round = 0;
      room.deadline = null;
      room.current = null;
      room.previousQuestion = null;
      room.winner = null;
      for (const p of room.players.values()) { p.health = room.startingHealth; p.guess = null; p.damage = null; }
      publish(room); return send(res, 200, { room: safeRoom(room) });
    }
    return send(res, 404, { error: 'Unknown action.' });
  }
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(here, 'public', requested);
  if (!file.startsWith(path.join(here, 'public'))) return send(res, 403, { error: 'Forbidden.' });
  try {
    const content = await import('node:fs/promises').then(fs => fs.readFile(file));
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8';
    res.writeHead(200, { 'content-type': type }); res.end(content);
  } catch { send(res, 404, { error: 'Not found.' }); }
});

setInterval(() => {
  for (const room of rooms.values()) if (room.phase === 'guessing' && room.deadline <= Date.now()) resolveRound(room, true);
}, 500);

server.listen(PORT, '0.0.0.0', () => {
  const addresses = Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal).map(x => `http://${x.address}:${PORT}`);
  console.log(`Speedle is ready at http://localhost:${PORT}${addresses.length ? `\nOn your Wi-Fi: ${addresses.join(', ')}` : ''}`);
});
