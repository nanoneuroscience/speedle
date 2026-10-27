const CHECKPOINTS = [
  [270, 970], [464, 901], [337, 818], [554, 745], [449, 660],
  [651, 584], [535, 505], [666, 426], [570, 345], [640, 264], [566, 169],
];

let mountainId = 0;

const clampLevel = value => Math.max(0, Math.min(10, Math.round(Number(value) || 0)));

function curvePoint(points, segment, t) {
  const p0 = points[Math.max(0, segment - 1)];
  const p1 = points[segment];
  const p2 = points[Math.min(points.length - 1, segment + 1)];
  const p3 = points[Math.min(points.length - 1, segment + 2)];
  return [0, 1].map(axis => 0.5 * (
    2 * p1[axis] + (-p0[axis] + p2[axis]) * t +
    (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t * t +
    (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t * t * t
  ));
}

function trailData() {
  const samples = [];
  const distances = [0];
  const levelDistances = [0];
  for (let segment = 0; segment < CHECKPOINTS.length - 1; segment += 1) {
    for (let step = segment === 0 ? 0 : 1; step <= 36; step += 1) {
      const point = curvePoint(CHECKPOINTS, segment, step / 36);
      const previous = samples[samples.length - 1];
      samples.push(point);
      if (previous) distances.push(distances[distances.length - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1]));
    }
    levelDistances.push(distances[distances.length - 1]);
  }
  return { samples, distances, levelDistances, total: distances[distances.length - 1], d: samples.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ') };
}

const TRAIL = trailData();

function pointAtDistance(distance) {
  const bounded = Math.max(0, Math.min(TRAIL.total, distance));
  let next = TRAIL.distances.findIndex(length => length >= bounded);
  if (next <= 0) return TRAIL.samples[0];
  const previous = next - 1;
  const span = TRAIL.distances[next] - TRAIL.distances[previous];
  const progress = span ? (bounded - TRAIL.distances[previous]) / span : 0;
  return [0, 1].map(axis => TRAIL.samples[previous][axis] + (TRAIL.samples[next][axis] - TRAIL.samples[previous][axis]) * progress);
}

const pine = (x, y, scale = 1, opacity = 1) => `<g transform="translate(${x} ${y}) scale(${scale})" opacity="${opacity}" class="mc-pine"><path d="M0 10V-66" stroke="#203e3d" stroke-width="8" stroke-linecap="round"/><path d="M0-105 25-57 12-58 34-20 18-22 42 15H-42l24-37-16 2 22-38-13 1Z" fill="#173e3c"/><path d="M0-102 0 10H-38l22-32-16 2 22-38-12 1Z" fill="#29524b"/></g>`;

function cheetahMarkup(prefix) {
  return `<g class="mc-cheetah">
    <ellipse class="mc-runner-shadow" cx="0" cy="5" rx="67" ry="10" fill="#0d272e" opacity=".22"/>
    <g class="mc-tail"><path d="M-45-43C-74-51-84-42-100-58S-118-76-133-69" fill="none" stroke="#e8ad39" stroke-width="13" stroke-linecap="round"/><path d="M-120-71Q-128-73-133-69" fill="none" stroke="#173540" stroke-width="13" stroke-linecap="round"/></g>
    <g class="mc-leg mc-leg-back-far"><path d="M-31-34-51-18-30 0-8 0" fill="none" stroke="#bf8528" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g class="mc-leg mc-leg-front-far"><path d="M35-34 28-11 58-7 74-16" fill="none" stroke="#bf8528" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></g>
    <path d="M-52-45C-45-67-19-63 0-58 18-53 35-60 47-52L58-39Q48-24 31-25L-16-29Q-38-21-52-45Z" fill="url(#${prefix}-fur)"/>
    <path d="M-35-30Q0-35 28-29" fill="none" stroke="#f8d78b" stroke-width="7" stroke-linecap="round"/>
    <g class="mc-leg mc-leg-back"><path d="M-35-37-50-14-67-5-79-8" fill="none" stroke="#efb23c" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="M-78-8-83-8" stroke="#173540" stroke-width="5" stroke-linecap="round"/></g>
    <g class="mc-leg mc-leg-front"><path d="M33-36 48-22 66-5 82-5" fill="none" stroke="#f7c35a" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="M80-5 86-5" stroke="#173540" stroke-width="5" stroke-linecap="round"/></g>
    <path d="M35-54 47-70 65-75 78-69 85-54 99-48 98-39 80-35 60-37 48-44Z" fill="url(#${prefix}-fur)"/>
    <path d="M50-68 49-81Q58-83 63-74M72-73 77-82Q85-79 84-66" fill="#e5a737" stroke="#173540" stroke-width="4" stroke-linejoin="round"/>
    <path d="M73-48Q83-42 97-44L97-38 81-35 65-39Z" fill="#fff0c3"/>
    <path d="M98-49 105-46 98-41" fill="#173540"/>
    <path d="M74-59 82-58 76-54Z" fill="#173540"/><path d="M78-56 84-43" fill="none" stroke="#173540" stroke-width="3.5" stroke-linecap="round"/>
    <g fill="#173540"><ellipse cx="-32" cy="-52" rx="4" ry="3" transform="rotate(-12 -32 -52)"/><ellipse cx="-14" cy="-48" rx="3.5" ry="3"/><ellipse cx="-24" cy="-38" rx="3.2" ry="2.8"/><ellipse cx="4" cy="-47" rx="3.2" ry="2.8"/><ellipse cx="16" cy="-39" rx="4" ry="3"/><ellipse cx="26" cy="-49" rx="3" ry="2.6"/><ellipse cx="-42" cy="-42" rx="3" ry="2.5"/><ellipse cx="62" cy="-58" rx="2.6" ry="2"/><ellipse cx="56" cy="-49" rx="2" ry="2.3"/><ellipse cx="66" cy="-46" rx="2.2" ry="2"/></g>
  </g>`;
}

/** Mount the ten-level mountain illustration into an existing element. */
export function mountMountain(container) {
  if (!(container instanceof Element)) throw new TypeError('mountMountain needs a container element.');
  const prefix = `speedle-mountain-${++mountainId}`;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let level = 0;
  let distance = 0;
  let animationFrame = 0;
  let celebrationTimer = 0;
  let recoilTimer = 0;
  let destroyed = false;
  let facing = 1;

  container.classList.add('mountain-scene');
  container.innerHTML = `<svg class="mc-world" viewBox="0 0 1000 1100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="A cheetah climbing ten checkpoints to the mountain summit">
    <defs>
      <linearGradient id="${prefix}-far" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#96b2ae"/><stop offset="1" stop-color="#719996"/></linearGradient>
      <linearGradient id="${prefix}-mountain" x1=".2" y1="0" x2=".8" y2="1"><stop stop-color="#507c79"/><stop offset=".5" stop-color="#2c6264"/><stop offset="1" stop-color="#214a50"/></linearGradient>
      <linearGradient id="${prefix}-ridge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#578883"/><stop offset="1" stop-color="#2c5c61"/></linearGradient>
      <linearGradient id="${prefix}-snow" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff9e9"/><stop offset="1" stop-color="#bed5cb"/></linearGradient>
      <linearGradient id="${prefix}-fur" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffdc71"/><stop offset="1" stop-color="#e9a32c"/></linearGradient>
      <linearGradient id="${prefix}-trail" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#dda94c"/><stop offset="1" stop-color="#f9dd9c"/></linearGradient>
      <radialGradient id="${prefix}-halo"><stop stop-color="#ffe9ad" stop-opacity=".65"/><stop offset="1" stop-color="#ffe9ad" stop-opacity="0"/></radialGradient>
      <filter id="${prefix}-runner-shadow" x="-70%" y="-70%" width="240%" height="240%"><feDropShadow dx="0" dy="6" stdDeviation="5" flood-color="#112f36" flood-opacity=".3"/></filter>
      <filter id="${prefix}-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="8"/></filter>
      <g id="${prefix}-cloud"><path d="M-112 14C-127-10-107-29-84-25-79-59-35-67-14-39 5-64 51-54 56-24 84-35 110-19 107 3 135 6 135 31 107 32H-91C-115 33-128 24-112 14Z" fill="currentColor"/></g>
    </defs>
    <g class="mc-atmosphere" aria-hidden="true">
      <circle cx="761" cy="167" r="92" fill="url(#${prefix}-halo)"/>
      <circle cx="761" cy="167" r="39" fill="#f3d58c" opacity=".74"/>
      <g class="mc-cloud mc-cloud-one" color="#e1e9dc" opacity=".78"><use href="#${prefix}-cloud" transform="translate(245 210) scale(.9 .62)"/></g>
      <g class="mc-cloud mc-cloud-two" color="#dce6d7" opacity=".67"><use href="#${prefix}-cloud" transform="translate(830 351) scale(.63 .47)"/></g>
      <path d="M-70 875 110 604 189 690 340 456 446 617 579 465 719 655 838 509 1080 846V1100H-70Z" fill="url(#${prefix}-far)" opacity=".45"/>
      <path d="M-80 920 115 710 204 791 351 610 484 762 624 580 751 721 885 623 1080 921V1100H-80Z" fill="#6b9791" opacity=".51"/>
      <g class="mc-birds" fill="none" stroke="#456c6c" stroke-width="4" stroke-linecap="round" opacity=".65"><path d="M302 129q14-11 27 0 14-11 27 0"/><path d="M349 157q9-8 18 0 9-8 18 0"/></g>
    </g>
    <g class="mc-mountain" aria-hidden="true">
      <path d="M39 1032 139 817 248 677 316 526 424 347 493 231 566 119 636 234 686 312 755 425 794 562 870 718 984 1032Z" fill="url(#${prefix}-mountain)"/>
      <path d="M566 119 539 275 465 381 493 448 396 585 435 688 313 819 255 1032H39l100-215 109-140 68-151 108-179 69-116Z" fill="#65918a" opacity=".52"/>
      <path d="M566 119 608 304 575 397 683 501 627 630 747 746 695 922 753 1032H984L870 718 794 562 755 425 686 312 636 234Z" fill="#173f4b" opacity=".33"/>
      <path d="M464 380 493 448 396 585 435 688 313 819 255 1032H392l88-182-11-94 101-120-41-108 68-114-31-95-27-44Z" fill="url(#${prefix}-ridge)" opacity=".58"/>
      <path d="M605 305 575 397 683 501 627 630 747 746 695 922 753 1032H614l39-145-66-130 54-90-62-102 23-83-66-71Z" fill="#3c7371" opacity=".64"/>
      <path d="M493 231 566 119 636 234 686 312 637 286 613 298 578 247 549 284 530 265 488 320 474 306 439 324Z" fill="url(#${prefix}-snow)"/>
      <path d="M566 119 549 284 578 247 613 298 600 237Z" fill="#eaf1de"/><path d="M566 119 600 237 613 298 637 286 686 312 636 234Z" fill="#c3d8cb"/>
      <path d="M459 349 440 390M402 491l-18 43M726 456l18 43M805 673l24 50M223 768l-22 38M478 885l-19 40M773 876l20 39" fill="none" stroke="#b5c9b1" opacity=".2" stroke-width="5" stroke-linecap="round"/>
      <path d="M104 1001Q159 980 206 1003T319 1003 443 1009 562 1000 707 1011 866 999 994 1026L1011 1100H-10V1048Z" fill="#244f4c"/>
      <path d="M65 1038Q183 1010 283 1037T483 1042 694 1030 944 1047" fill="none" stroke="#4e7461" stroke-width="18" opacity=".5"/>
    </g>
    <g class="mc-route" aria-hidden="true">
      <path d="${TRAIL.d}" fill="none" stroke="#153c44" stroke-width="25" stroke-linecap="round" opacity=".26" transform="translate(0 5)"/>
      <path d="${TRAIL.d}" fill="none" stroke="url(#${prefix}-trail)" stroke-width="13" stroke-linecap="round" opacity=".46"/>
      <path d="${TRAIL.d}" fill="none" stroke="#f8df9c" stroke-width="2" stroke-dasharray="2 15" stroke-linecap="round" opacity=".7"/>
      <path class="mc-route-complete" d="${TRAIL.d}" fill="none" stroke="#f5ce76" stroke-width="10" stroke-linecap="round" stroke-dasharray="${TRAIL.total}" stroke-dashoffset="${TRAIL.total}"/>
      ${CHECKPOINTS.map(([x, y], index) => `<g class="mc-checkpoint${index === 0 ? ' is-current' : ''}" data-level="${index}" transform="translate(${x} ${y})"><circle class="mc-node-aura" r="26" fill="#ffdf89" opacity="0"/><circle class="mc-node-ring" r="15" fill="#2c5960" stroke="#c1c9a5" stroke-width="3"/><circle class="mc-node-dot" r="5" fill="#9cb6a5"/>${index ? `<g class="mc-checkpoint-plaque" transform="translate(${index % 2 ? 29 : -65} -13)"><path d="M0 0H32L38 13 32 26H0L-6 13Z" fill="#173c45" fill-opacity=".83" stroke="#9bb4a1" stroke-opacity=".25"/><text x="16" y="17" text-anchor="middle" fill="#e8e7cf" font-size="15" font-weight="750" font-family="Inter, system-ui, sans-serif">${String(index).padStart(2, '0')}</text></g>` : ''}</g>`).join('')}
    </g>
    <g class="mc-summit" transform="translate(565 122)" aria-hidden="true"><path d="M0 19V-61" stroke="#f4e3b9" stroke-width="5" stroke-linecap="round"/><path class="mc-summit-flag" d="M2-61C21-68 30-46 49-53V-22C29-15 20-38 2-31Z" fill="#f2bd52"/><path d="m14-52 10 10-10 10" fill="none" stroke="#514528" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>
    <g class="mc-foreground" aria-hidden="true">
      ${pine(153, 1007, 1.3)}${pine(103, 1041, .83)}${pine(205, 1033, .79)}${pine(848, 1007, 1.43)}${pine(915, 1045, 1.05)}${pine(781, 1036, .7)}
      <g fill="#426c55"><path d="m321 1031-20-38 5 37-29-21 19 28Z"/><path d="m707 1042-8-44-7 39-18-20 11 29Z"/><path d="m566 1066 6-38-19 34-5-24-6 30Z"/></g>
      <g fill="#dabd79"><circle cx="329" cy="1026" r="3"/><circle cx="339" cy="1023" r="3"/><circle cx="695" cy="1045" r="3"/><circle cx="575" cy="1065" r="3"/></g>
      <path d="M238 1016q15-10 28-3l-7 12h-25ZM729 1000q17-11 33-1l-8 14h-33Z" fill="#6d8b72"/>
    </g>
    <g class="mc-high-cloud mc-cloud-three" color="#dbe6d6" opacity=".77" aria-hidden="true"><use href="#${prefix}-cloud" transform="translate(166 567) scale(.9 .49)"/></g>
    <g class="mc-high-cloud mc-cloud-four" color="#dce7d7" opacity=".52" aria-hidden="true"><use href="#${prefix}-cloud" transform="translate(853 758) scale(.78 .43)"/></g>
    <g class="mc-runner-position" transform="translate(270 970)" aria-hidden="true"><g class="mc-runner-recoil"><g class="mc-runner-facing"><g filter="url(#${prefix}-runner-shadow)">${cheetahMarkup(prefix)}</g></g></g><g class="mc-dust"><circle cx="-60" cy="1" r="8"/><circle cx="-78" cy="-6" r="5"/><circle cx="-88" cy="3" r="3"/></g></g>
    <g class="mc-celebration" aria-hidden="true">${Array.from({ length: 26 }, (_, i) => `<rect x="${385 + (i * 47) % 370}" y="${90 + (i * 31) % 140}" width="${5 + i % 4}" height="${9 + i % 6}" rx="1" fill="${['#f9d26b', '#f7ead0', '#83ada0', '#e8a864'][i % 4]}" style="--confetti-i:${i};--confetti-x:${(i % 2 ? 1 : -1) * (35 + i * 8)}px;--confetti-r:${(i % 2 ? 1 : -1) * (100 + i * 24)}deg"/>`).join('')}</g>
  </svg>`;

  const svg = container.querySelector('.mc-world');
  const runner = container.querySelector('.mc-runner-position');
  const directionGroup = container.querySelector('.mc-runner-facing');
  const progressPath = container.querySelector('.mc-route-complete');
  const nodes = [...container.querySelectorAll('.mc-checkpoint')];

  function paint(positionDistance, updateFacing = false) {
    const point = pointAtDistance(positionDistance);
    if (updateFacing) {
      const ahead = pointAtDistance(Math.min(TRAIL.total, positionDistance + 5));
      const behind = pointAtDistance(Math.max(0, positionDistance - 5));
      const deltaX = ahead[0] - behind[0];
      if (Math.abs(deltaX) > .1) facing = deltaX > 0 ? 1 : -1;
    }
    runner.setAttribute('transform', `translate(${point[0].toFixed(2)} ${point[1].toFixed(2)})`);
    directionGroup.setAttribute('transform', `scale(${facing} 1) scale(.79)`);
    progressPath.style.strokeDashoffset = String(TRAIL.total - positionDistance);
    distance = positionDistance;
  }

  function updateNodes() {
    nodes.forEach((node, index) => {
      node.classList.toggle('is-complete', index < level);
      node.classList.toggle('is-current', index === level);
    });
    svg.setAttribute('aria-label', `Your cheetah is at level ${level} of 10 on the mountain${level === 10 ? ' summit' : ''}.`);
    container.dataset.level = String(level);
  }

  function setLevel(nextLevel, { animate = true } = {}) {
    if (destroyed) return;
    const next = clampLevel(nextLevel);
    if (next === level && container.classList.contains('is-running')) return;
    cancelAnimationFrame(animationFrame);
    const target = TRAIL.levelDistances[next];
    const start = distance;
    const isForward = target >= start;
    level = next;
    updateNodes();
    if (!animate || reducedMotion.matches || Math.abs(target - start) < 1) {
      container.classList.remove('is-running');
      paint(target, true);
      return;
    }
    const startTime = performance.now();
    const duration = Math.min(1650, Math.max(980, Math.abs(target - start) * 4.6));
    container.classList.add('is-running');
    function tick(now) {
      if (destroyed) return;
      const progress = Math.min(1, (now - startTime) / duration);
      const ease = progress < .5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      paint(start + (target - start) * ease, true);
      if (!isForward) directionGroup.setAttribute('transform', `scale(${-facing} 1) scale(.79)`);
      if (progress < 1) animationFrame = requestAnimationFrame(tick);
      else container.classList.remove('is-running');
    }
    animationFrame = requestAnimationFrame(tick);
  }

  function celebrate() {
    if (destroyed) return;
    window.clearTimeout(celebrationTimer);
    container.classList.remove('is-celebrating');
    void container.offsetWidth;
    container.classList.add('is-celebrating');
    celebrationTimer = window.setTimeout(() => container.classList.remove('is-celebrating'), 3100);
  }

  function recoil() {
    if (destroyed || reducedMotion.matches) return;
    window.clearTimeout(recoilTimer);
    container.classList.remove('is-recoiling');
    void container.offsetWidth;
    container.classList.add('is-recoiling');
    recoilTimer = window.setTimeout(() => container.classList.remove('is-recoiling'), 470);
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(animationFrame);
    window.clearTimeout(celebrationTimer);
    window.clearTimeout(recoilTimer);
    container.classList.remove('mountain-scene', 'is-running', 'is-celebrating', 'is-recoiling');
    container.removeAttribute('data-level');
    container.replaceChildren();
  }

  paint(0);
  updateNodes();
  return { setLevel, celebrate, recoil, destroy };
}
