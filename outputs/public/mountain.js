import { mountMountain } from './mountain-scene.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const safeUrl = value => { try { const url = new URL(value, location.origin); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
const readLocal = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const saveLocal = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const participantId = readLocal('speedle-player-profile-id', '') || crypto.randomUUID();
saveLocal('speedle-player-profile-id', participantId);
const mountain = mountMountain($('#mountain-world'));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stage = $('#matchup-stage');
const feedback = $('#round-feedback');
let game = null;
let phase = 'loading';
let displayedPair = null;
let units = readLocal('speedle-climb-units', 'imperial') === 'metric' ? 'metric' : 'imperial';
let soundOn = readLocal('speedle-climb-sound', 'off') === 'on';
let pairLoad = 0;
let gameRequest = 0;
let audioContext;
let noticeTimer;
let midnightTimer;
let nextReady = true;
const imageCache = new Map();

const icons = {
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>',
  silent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 4-5 4H3v8h3l5 4V4Zm5 5 5 6m0-6-5 6"/></svg>',
  mountain: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m3 40 16-30 10 17 7-10 10 23H3Z"/><path d="m13 21 6 5 5-6m6 8 6 3 4-5M23 10V2l12 3-12 4"/></svg>',
  trail: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 27c-3-6 17-4 14-10-2-4-11-3-8-7 2-3 7-3 9-7m0 0v7m0-7h-7"/><circle cx="5" cy="27" r="2"/></svg>'
};
const biomeNames = ['BASE CAMP','THE FOOTHILLS','PINE COUNTRY','THE RIDGELINE','ALPINE MEADOW','ABOVE THE TREES','THE HIGH PASS','CLOUD COUNTRY','SNOW LINE','THE FINAL RIDGE','THE SUMMIT'];
const dateText = day => new Intl.DateTimeFormat('en-US', {month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`));
const speedText = value => {
  const speed = units === 'metric' ? Number(value) * 1.609344 : Number(value);
  return new Intl.NumberFormat('en-US', {maximumFractionDigits:speed >= 100 ? 0 : speed >= 10 ? 1 : 2}).format(speed);
};
const unitText = () => units === 'metric' ? 'km/h' : 'mph';
function notify(message) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.add('is-visible');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove('is-visible'), 3800);
}
async function api(path, data) {
  const response = await fetch(path, {method:data ? 'POST' : 'GET', headers:data ? {'Content-Type':'application/json'} : {}, body:data ? JSON.stringify(data) : undefined, cache:'no-store'});
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.error || 'The trail is temporarily unavailable.'), {status:response.status});
  return payload;
}
function imageReady(src) {
  if (!src) return Promise.resolve(false);
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise(resolve => {
      const image = new Image();
      image.decoding = 'async';
      let settled = false;
      const finish = okay => { if (!settled) { settled = true; clearTimeout(timer); if (!okay) imageCache.delete(src); resolve(okay); } };
      const timer = setTimeout(() => finish(false), 6500);
      image.onload = async () => { try { await image.decode(); } catch {} const okay = image.naturalWidth > 0; if (okay) imageCache.set(src, Promise.resolve(true)); finish(okay); };
      image.onerror = () => finish(false);
      image.src = src;
    }));
  }
  return imageCache.get(src);
}
function renderUnits() {
  const group = $('.unit-switch');
  group.classList.toggle('is-metric', units === 'metric');
  for (const button of group.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.unit === units));
  for (const speed of stage.querySelectorAll('[data-speed]')) {
    speed.innerHTML = `<strong>${speedText(speed.dataset.speed)}</strong><small>${unitText()}</small>`;
    const card = speed.closest('.choice-card');
    const name = card.querySelector('h3').textContent;
    card.setAttribute('aria-label', `${name}: ${speedText(speed.dataset.speed)} ${unitText()}. ${card.classList.contains('is-correct') ? 'Faster' : 'Slower'} object.`);
  }
}
function renderSound() {
  const button = $('#sound-toggle');
  button.innerHTML = soundOn ? icons.sound : icons.silent;
  button.setAttribute('aria-pressed', String(soundOn));
  button.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
}
function playTone(correct = true) {
  if (!soundOn) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const notes = correct ? [440,554.37,659.25] : [261.63,220];
    notes.forEach((frequency,index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime + index * .09;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0,start); gain.gain.linearRampToValueAtTime(.035,start+.015); gain.gain.exponentialRampToValueAtTime(.001,start+.33);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(start); oscillator.stop(start+.36);
    });
  } catch {}
}
function updateHUD(animate = false) {
  if (!game) return;
  $('.challenge-side').classList.toggle('is-finished', phase === 'finished');
  $('#challenge-date').dateTime = game.day;
  $('#challenge-date').textContent = dateText(game.day);
  $('#altitude').textContent = game.level;
  $('#altitude-meter').style.width = `${game.level * 10}%`;
  $('#biome-label').textContent = biomeNames[game.level];
  $('#round-count').innerHTML = game.completed ? `<span>FINAL SCORE</span> ${game.attempts}` : `MATCHUP ${String(game.attempts + (phase === 'result' ? 0 : 1)).padStart(2,'0')}`;
  $('#progress-track').innerHTML = Array.from({length:10},(_,index) => `<span class="level-step ${index < game.level ? 'is-reached' : ''} ${index === game.level-1 ? 'is-current' : ''}" title="Level ${index+1}${index < game.level ? ' reached' : ''}"></span>`).join('');
  $('#progress-track').setAttribute('aria-label', `${game.level} of 10 mountain levels reached in ${game.attempts} matchup${game.attempts === 1 ? '' : 's'}`);
  mountain.setLevel(game.level,{animate});
  clearTimeout(midnightTimer);
  const untilReset = Date.parse(game.nextResetAt) - Date.now();
  if (Number.isFinite(untilReset)) midnightTimer = setTimeout(() => { if (phase !== 'answering') { notify('A new day. A new mountain to climb.'); loadGame(); } },Math.max(1000,untilReset+1000));
}
function imageMarkup(item, okay) {
  if (okay) return `<img src="${esc(item.imagePath)}" alt="${esc(item.name)}" width="800" height="600" decoding="async" draggable="false">`;
  return `<div class="image-fallback">${icons.mountain}<span>${esc(item.name)}</span></div>`;
}
function creditMarkup(item) {
  const url = safeUrl(item.imageSourceUrl);
  if (!url || !item.imageCredit) return '';
  const short = item.imageCredit.replace(/^Photo:\s*/i,'').split(/\s*\/\s*Wikimedia|\s*\/\s*Wikipedia|,\s*CC\s/i)[0];
  return `<a class="photo-credit" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(item.imageCredit)}">${esc(short)} ↗</a>`;
}
async function renderPair(pair) {
  const token = ++pairLoad;
  phase = 'loading';
  displayedPair = pair;
  stage.setAttribute('aria-busy','true');
  if (!stage.querySelector('.matchup-pair')) stage.innerHTML = '<div class="loading-trail"><div class="trail-spinner"></div><span>Getting your next matchup ready…</span></div>';
  else stage.querySelector('.matchup-pair').classList.add('pair-leaving');
  feedback.innerHTML = `<div class="feedback-idle">${icons.trail}<span>A correct pick takes you one level higher.</span></div>`;
  const ready = await Promise.all(pair.objects.map(item => imageReady(item.imagePath)));
  if (token !== pairLoad) return;
  stage.innerHTML = `<div class="matchup-pair">${pair.objects.map((item,index) => `<div class="choice-wrap"><button class="choice-card" data-choice="${esc(item.id)}" aria-label="Choose ${esc(item.name)} as faster"><div class="choice-photo">${imageMarkup(item,ready[index])}<span class="photo-scrim"></span><span class="choice-key" aria-hidden="true">${index ? '→' : '←'}</span><span class="choice-speed" aria-hidden="true"></span></div><div class="choice-details"><span class="object-category">${esc(category(item.kind))}</span><h3>${esc(item.name)}</h3><p class="object-blurb">${esc(item.blurb || '')}</p></div></button>${creditMarkup(item)}<a class="speed-source" hidden target="_blank" rel="noopener noreferrer">Source ↗</a></div>`).join('')}<span class="vs-medallion" aria-hidden="true">VS</span></div>`;
  stage.setAttribute('aria-busy','false');
  phase = 'guessing';
  $('#question-kicker').textContent = game.level === 0 ? 'TRUST YOUR INSTINCTS' : `${10-game.level} LEVEL${10-game.level===1 ? '' : 'S'} TO THE SUMMIT`;
  $('#question-title').textContent = 'Which is faster?';
  $('#challenge-footnote').hidden = false;
  updateHUD();
}
function category(kind) {
  return String(kind || 'WILD CARD').replace(/[()]/g,'').replace(/ANIMALS\s*/,'').replace(/OBJECT\s*·\s*/,'').replace(/\s*·\s*/g,' / ').trim();
}
function revealCards(result) {
  for (const card of stage.querySelectorAll('.choice-card')) {
    const object = result.objects.find(item => item.id === card.dataset.choice);
    const faster = object.id === result.correctId;
    card.disabled = true;
    card.classList.remove('is-pending');
    card.classList.add('is-revealed');
    card.classList.toggle('is-correct',faster);
    card.classList.toggle('is-incorrect',!faster && object.id === result.choiceId);
    card.classList.toggle('is-selected',object.id === result.choiceId);
    card.classList.toggle('is-other',!faster && object.id !== result.choiceId);
    const speed = card.querySelector('.choice-speed');
    speed.dataset.speed = object.speed;
    speed.setAttribute('aria-hidden','false');
    speed.innerHTML = `<strong>${speedText(object.speed)}</strong><small>${unitText()}</small>`;
    if (faster || object.id === result.choiceId) card.querySelector('.choice-photo').insertAdjacentHTML('beforeend',`<span class="answer-mark" aria-label="${faster ? 'Faster object' : 'Incorrect choice'}">${faster ? '✓' : '×'}</span>`);
    card.setAttribute('aria-label',`${object.name}: ${speedText(object.speed)} ${unitText()}. ${faster ? 'Faster object.' : 'Slower object.'}`);
    const source = card.parentElement.querySelector('.speed-source');
    const sourceUrl = safeUrl(object.source);
    if (sourceUrl) { source.href = sourceUrl; source.hidden = false; }
  }
}
async function choose(id) {
  if (phase !== 'guessing' || !displayedPair || !game) return;
  phase = 'answering';
  nextReady = false;
  for (const card of stage.querySelectorAll('.choice-card')) {
    card.disabled = true;
    if (card.dataset.choice === id) card.classList.add('is-selected','is-pending');
  }
  feedback.innerHTML = `<div class="feedback-idle">${icons.trail}<span>Checking the trail…</span></div>`;
  try {
    const oldLevel = game.level;
    const response = await api('/api/climb/answer',{participantId,day:game.day,challengeId:game.challengeId,pairId:displayedPair.id,choiceId:id});
    game = response;
    phase = 'result';
    const result = game.lastResult;
    revealCards(result);
    updateHUD(result.correct);
    if (!result.correct) mountain.recoil();
    playTone(result.correct);
    if (result.correct && !reducedMotion.matches) sparkle();
    if (game.completed && oldLevel < 10) setTimeout(() => { mountain.celebrate(); confetti(); },reducedMotion.matches ? 0 : 1150);
    feedback.innerHTML = `<div class="feedback-copy ${result.correct ? '' : 'is-wrong'}"><span class="feedback-icon" aria-hidden="true">${result.correct ? '↗' : '↔'}</span><div><strong>${result.correct ? (game.completed ? 'Hello, summit!' : ['Up you go!','Onwards and upwards.','Higher ground!'][game.level%3]) : 'Hold your ground.'}</strong><p>${result.correct ? (game.completed ? `${game.attempts} matchups. Ten levels. You made it.` : `Level ${game.level} reached. ${10-game.level} to the top.`) : 'No level lost. The next step is yours.'}</p></div></div><button id="next-matchup" class="gold-button" disabled>${game.completed ? 'Your result' : 'Keep climbing'}<span>↗</span></button>`;
    setTimeout(() => { nextReady = true; const button = $('#next-matchup'); if (button) button.disabled = false; },reducedMotion.matches ? 20 : result.correct ? 1100 : 650);
    $('#question-kicker').textContent = result.correct ? 'A STEP IN THE RIGHT DIRECTION' : 'A LITTLE WISER FOR THE CLIMB';
    $('#question-title').textContent = result.correct ? 'Good instincts.' : 'A close call.';
    $('#challenge-footnote').innerHTML = `<span><kbd>↵</kbd> to ${game.completed ? 'see your result' : 'keep climbing'}</span><span>${game.attempts} matchup${game.attempts===1 ? '' : 's'} · ${game.level} level${game.level===1 ? '' : 's'} climbed</span>`;
  } catch (error) {
    notify(error.status===409 ? 'Your trail has moved on. Restoring your progress…' : 'Connection interrupted. Restoring your saved climb…');
    await loadGame();
  }
}
async function next() {
  if (phase !== 'result' || !nextReady) return;
  if (game.completed) return showSummit();
  $('#challenge-footnote').innerHTML = '<span><kbd>←</kbd> <kbd>→</kbd> or tap to choose</span><span>Same trail for everyone</span>';
  await renderPair(game.pair);
}
function showSummit() {
  phase = 'finished';
  pairLoad += 1;
  displayedPair = null;
  updateHUD();
  $('#question-kicker').textContent = 'TODAY’S EXPEDITION COMPLETE';
  $('#question-title').textContent = 'Worth the climb.';
  stage.setAttribute('aria-busy','false');
  stage.innerHTML = `<div class="summit-card"><div class="summit-emblem">${icons.mountain}</div><span class="summit-overline">${game.perfect ? 'THE PERFECT CLIMB' : 'SUMMIT REACHED'}</span><h3>You made it to the top.</h3><p>${game.perfect ? 'Ten matchups. Ten right answers. Not a single step out of place.' : 'A little persistence and a lot of speed sense. That’s how you climb a mountain.'}</p><div class="final-score"><strong>${game.score ?? game.attempts}</strong><span>matchups to the summit</span></div><div class="result-mosaic" aria-label="${game.attempts} answers: ${game.level} correct">${game.results.map(result => `<i class="${result.correct ? 'correct' : ''}"></i>`).join('')}</div><button id="share-climb" class="gold-button share-button">Share your climb <span>↗</span></button><p class="summit-stats">10 is perfect. Lower is better.</p></div>`;
  feedback.innerHTML = `<div class="feedback-copy"><span class="feedback-icon" aria-hidden="true">✳</span><div><strong>Another mountain tomorrow.</strong><p>A fresh trail arrives at midnight UTC.</p></div></div><span class="summit-streak">${game.streak} day${game.streak===1 ? '' : 's'}<small>SUMMIT STREAK</small></span>`;
  $('#challenge-footnote').hidden = true;
}
async function loadGame() {
  const initial = !game;
  const request = ++gameRequest;
  pairLoad += 1;
  phase = 'loading';
  stage.setAttribute('aria-busy','true');
  for (const card of stage.querySelectorAll('.choice-card')) card.disabled = true;
  try {
    const data = await api(`/api/climb?participant=${encodeURIComponent(participantId)}`);
    if (request !== gameRequest) return;
    game = data;
    phase = data.completed ? 'finished' : 'loading';
    updateHUD();
    if (data.completed) showSummit();
    else await renderPair(data.pair);
  } catch (error) {
    if (request !== gameRequest) return;
    phase = 'error';
    stage.setAttribute('aria-busy','false');
    stage.innerHTML = `<div class="load-error">${icons.mountain}<h3>A small pause on the trail.</h3><p>${esc(initial ? 'We couldn’t load today’s mountain. Your saved progress will be here when you reconnect.' : error.message)}</p><button class="gold-button" id="retry-load">Try again <span>↗</span></button></div>`;
    feedback.innerHTML = '';
  }
}
async function share() {
  const marks = game.results.map(result => result.correct ? '🟨' : '⬜');
  const rows = Array.from({length:Math.ceil(marks.length/10)},(_,i) => marks.slice(i*10,i*10+10).join(''));
  const link = /^(localhost|127\.)/.test(location.hostname) ? '' : `\n${location.origin}`;
  const text = `Speedle · The Daily Climb\n${dateText(game.day)}\n${game.attempts} matchups to the summit${game.perfect ? ' · Perfect climb!' : ''}\n${rows.join('\n')}${link}`;
  try { await navigator.clipboard.writeText(text); notify('Your climb is copied. Share the view from the top.'); }
  catch {
    if (navigator.share) { try { await navigator.share({title:'My Speedle climb',text}); } catch {} }
    else notify('Sharing isn’t available in this browser.');
  }
}
function sparkle() {
  const field = $('#particles');
  for (let index=0;index<7;index++) {
    const particle = document.createElement('i'); particle.className='climb-flash';
    particle.style.setProperty('--delay',`${index*.07}s`); particle.style.setProperty('--drift',`${(index-3)*17}px`);
    field.append(particle); setTimeout(() => particle.remove(),1600);
  }
}
function confetti() {
  if (reducedMotion.matches) return;
  const field = $('#particles');
  for (let index=0;index<55;index++) {
    const particle = document.createElement('i'); particle.className='confetti';
    const values = {x:`${Math.random()*100}%`,size:`${5+Math.random()*6}px`,color:['#f9ce5b','#9cdbba','#fff3d5','#e9aa7e'][index%4],duration:`${3+Math.random()*3}s`,delay:`${Math.random()*.8}s`,drift:`${(Math.random()-.5)*250}px`,rotation:`${(Math.random()-.5)*1200}deg`};
    for (const [key,value] of Object.entries(values)) particle.style.setProperty(`--${key}`,value);
    field.append(particle); setTimeout(() => particle.remove(),7000);
  }
}
async function openProfile() {
  $('#profile-dialog').showModal();
  const stats = game?.stats || {};
  $('#profile-stats').innerHTML = [['Summit streak',game?.streak||0],['Best streak',game?.bestStreak||0],['Summits',stats.summits||0]].map(([label,value]) => `<div class="profile-stat"><strong>${value}</strong><span>${label.toUpperCase()}</span></div>`).join('');
  $('#display-name').value = readLocal('speedle-climb-name','');
  $('#profile-feedback').textContent = '';
  if (!game) return;
  try { const data=await api(`/api/daily-leaderboard?day=${game.day}&participant=${participantId}`); if (data.profile?.displayName) $('#display-name').value=data.profile.displayName; } catch {}
}
async function saveProfile(event) {
  event.preventDefault();
  const message = $('#profile-feedback');
  const button = $('#profile-form button');
  button.disabled=true; message.textContent='Saving your trail name…'; message.classList.remove('is-error');
  try { const data=await api('/api/daily-profile',{participantId,displayName:$('#display-name').value}); saveLocal('speedle-climb-name',data.profile.displayName); message.textContent='Your trail name is saved.'; }
  catch(error) { message.textContent=error.message; message.classList.add('is-error'); }
  finally {button.disabled=false;}
}

stage.addEventListener('click',event => { const choice=event.target.closest('[data-choice]'); if(choice) choose(choice.dataset.choice); if(event.target.closest('#retry-load')) loadGame(); if(event.target.closest('#share-climb')) share(); });
feedback.addEventListener('click',event => { if(event.target.closest('#next-matchup')) next(); });
$('.unit-switch').addEventListener('click',event => { const button=event.target.closest('[data-unit]'); if(button){units=button.dataset.unit;saveLocal('speedle-climb-units',units);renderUnits();} });
$('#sound-toggle').addEventListener('click',() => {soundOn=!soundOn;saveLocal('speedle-climb-sound',soundOn?'on':'off');renderSound();if(soundOn)playTone(true);});
$('#help-open').addEventListener('click',() => $('#help-dialog').showModal());
$('#profile-open').addEventListener('click',openProfile);
$('#profile-form').addEventListener('submit',saveProfile);
for (const dialog of document.querySelectorAll('.game-dialog')) {
  dialog.addEventListener('click',event => { if(event.target.closest('[data-close]'))dialog.close(); if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();} });
}
document.addEventListener('keydown',event => {
  if(document.querySelector('dialog[open]')||event.altKey||event.ctrlKey||event.metaKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
  const index=['ArrowLeft','1','a','A'].includes(event.key)?0:['ArrowRight','2','d','D'].includes(event.key)?1:null;
  if(index!==null&&phase==='guessing'){event.preventDefault();choose(displayedPair.objects[index].id);}
  if(event.key==='Enter'&&phase==='result'){event.preventDefault();next();}
});
document.addEventListener('visibilitychange',() => {if(!document.hidden&&game&&game.day!==new Date().toISOString().slice(0,10)&&phase!=='answering')loadGame();});
renderUnits();renderSound();loadGame();
