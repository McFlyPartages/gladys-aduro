// -----------------------------------------------------------------------------
// Renders the pictures of the "Stove" dashboard widget: an original drawing of
// a pellet stove, its fire animated (animated WebP, looping), in six states:
// off, ignition (the igniter heats the pellets, smoke, no flame yet), flame
// I, II, III, and logs burning (wood mode).
//
//   node scripts/render-stove.mjs        -> assets/stove-*.webp
//
// Development tool only (sharp is a devDependency): the generated files are
// committed and shipped in the image, the integration never renders.
// The Gladys core accepts 300 KB at most per picture, shown in a 16:9 frame.
// -----------------------------------------------------------------------------

import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const WIDTH = 800;
const HEIGHT = 450;
const FRAMES = 18;
const FRAME_MS = 70;
const MAX_BYTES = 300 * 1024;

// Fire chamber (the glass door) and the burn pot at its bottom.
const WINDOW = { x: 322, y: 118, w: 156, h: 190, r: 10 };
const BASE_Y = WINDOW.y + WINDOW.h - 22;
const CX = 400;
// 16:9 crop around the stove: it fills the widget frame.
const VIEW = '72 36 656 369';

export const VARIANTS = {
  off: { level: 0 },
  ignition: { level: 0, ignition: true },
  l1: { level: 1 },
  l2: { level: 2 },
  l3: { level: 3 },
  wood: { level: 0, wood: true },
};

// Flame size per heat level: width and height of the main tongue.
const FLAME = { 1: [46, 62], 2: [70, 108], 3: [96, 150] };

const TAU = Math.PI * 2;
const f = (value) => value.toFixed(1);

/** One tongue of fire: a drop shape whose tip sways. */
function tongue(cx, baseY, width, height, sway) {
  const left = cx - width / 2;
  const right = cx + width / 2;
  const tipX = cx + sway;
  const tipY = baseY - height;
  return (
    `M${f(left)},${f(baseY)} ` +
    `C${f(left - width * 0.25)},${f(baseY - height * 0.5)} ${f(tipX - width * 0.28)},${f(tipY + height * 0.3)} ${f(tipX)},${f(tipY)} ` +
    `C${f(tipX + width * 0.24)},${f(tipY + height * 0.34)} ${f(right + width * 0.25)},${f(baseY - height * 0.5)} ${f(right)},${f(baseY)} ` +
    `Q${f(cx)},${f(baseY + width * 0.18)} ${f(left)},${f(baseY)} Z`
  );
}

const LAYERS = [
  { scale: 1, color: 'url(#flameOuter)', opacity: 0.9 },
  { scale: 0.72, color: '#ff9a1f', opacity: 0.95 },
  { scale: 0.48, color: '#ffd84d', opacity: 0.95 },
  { scale: 0.26, color: '#fff6c8', opacity: 0.9 },
];

/**
 * A fire made of several tongues. Every oscillation uses a whole number of
 * turns over the loop, so the last frame flows into the first one.
 */
function fire({ cx, baseY, width, height, tongues, phase, spread }) {
  const shapes = [];
  for (let index = 0; index < tongues; index += 1) {
    const offset = tongues === 1 ? 0 : (index / (tongues - 1) - 0.5) * spread;
    const seed = index * 1.7;
    const centre = Math.abs(offset) / (spread / 2 || 1);
    const size = 1 - 0.45 * centre;
    const h =
      height *
      size *
      (0.86 + 0.1 * Math.sin(phase * 2 + seed) + 0.05 * Math.sin(phase * 3 + seed * 2));
    const w = width * (0.55 + 0.45 * size) * (0.95 + 0.05 * Math.sin(phase + seed));
    const sway = width * 0.18 * Math.sin(phase + seed) + width * 0.06 * Math.sin(phase * 3 + seed);
    shapes.push({ x: cx + offset, w, h, sway });
  }
  // Big tongues behind, small ones in front.
  shapes.sort((a, b) => b.h - a.h);
  return LAYERS.map(
    ({ scale, color, opacity }) =>
      `<g fill="${color}" opacity="${opacity}">` +
      shapes
        .map(
          ({ x, w, h, sway }) =>
            `<path d="${tongue(x, baseY, w * scale, h * scale, sway * scale)}"/>`,
        )
        .join('') +
      '</g>',
  ).join('');
}

function logs() {
  const log = (x, y, length, angle, tone) =>
    `<g transform="translate(${x},${y}) rotate(${angle})">` +
    `<rect x="${-length / 2}" y="-10" width="${length}" height="20" rx="10" fill="${tone}"/>` +
    `<rect x="${-length / 2 + 4}" y="-10" width="${length - 8}" height="4" rx="2" fill="#ff7a2a" opacity="0.55"/>` +
    `<rect x="${-length / 2 + 6}" y="-5" width="${length - 18}" height="3" rx="1.5" fill="#3a2414" opacity="0.6"/>` +
    `<ellipse cx="${length / 2 - 4}" cy="0" rx="5" ry="9" fill="#c89a63"/>` +
    `<ellipse cx="${length / 2 - 4}" cy="0" rx="2.5" ry="5" fill="#8a5a2e"/>` +
    '</g>';
  return (
    log(CX - 18, BASE_Y + 6, 112, -10, '#5b3820') +
    log(CX + 18, BASE_Y + 8, 106, 12, '#6a4226') +
    log(CX, BASE_Y - 4, 88, 2, '#4e2f1a')
  );
}

function sparks(phase) {
  let dots = '';
  for (let index = 0; index < 7; index += 1) {
    const progress = (phase / TAU + index / 7) % 1;
    const x = CX - 50 + index * 16 + 8 * Math.sin(phase * 2 + index);
    const y = BASE_Y - 30 - progress * 120;
    const opacity = (1 - progress) * 0.9;
    dots += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1.6 + (index % 2))}" fill="#ffcf5a" opacity="${f(opacity)}"/>`;
  }
  return dots;
}

/** Pellets in the burn pot, the igniter glowing under them, smoke rising. */
function ignition(phase) {
  const heat = 0.55 + 0.45 * Math.sin(phase);
  let pellets = '';
  for (let index = 0; index < 16; index += 1) {
    const x = CX - 22 + (index % 8) * 6 + (index > 7 ? 3 : 0);
    const y = BASE_Y - 2 - (index > 7 ? 4 : 0);
    pellets += `<ellipse cx="${x}" cy="${y}" rx="3.2" ry="2.2" fill="${index % 3 ? '#7a5a3a' : '#8d6a45'}"/>`;
  }
  let smoke = '';
  for (let wisp = 0; wisp < 3; wisp += 1) {
    for (let puff = 0; puff < 6; puff += 1) {
      const progress = (phase / TAU + puff / 6 + wisp / 3 / 6) % 1;
      const x = CX - 14 + wisp * 14 + 12 * Math.sin(progress * TAU * 1.5 + wisp * 2);
      const y = BASE_Y - 10 - progress * 140;
      const radius = 5 + progress * 16;
      const opacity = 0.42 * (1 - progress) * Math.min(1, progress * 6);
      smoke += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(radius)}" fill="#a39d97" opacity="${f(opacity)}"/>`;
    }
  }
  return (
    `<ellipse cx="${CX}" cy="${BASE_Y + 2}" rx="${f(30 + 8 * heat)}" ry="${f(10 + 3 * heat)}" fill="url(#igniter)" opacity="${f(0.5 + 0.5 * heat)}"/>` +
    pellets +
    `<g filter="url(#smoke)">${smoke}</g>`
  );
}

function frame({ level, wood, ignition: igniting }, index) {
  const phase = (TAU * index) / FRAMES;
  const burning = level > 0 || wood;
  const flicker = 0.85 + 0.15 * Math.sin(phase * 2) * Math.sin(phase * 3 + 1);
  const glow = burning ? (wood ? 0.75 : 0.35 + 0.18 * level) * flicker : igniting ? 0.12 : 0;
  // Status light: steady when burning, blinking during the ignition.
  const light = burning || (igniting && Math.sin(phase) > 0) ? '#ff9a2a' : '#3a3c40';

  // A blurred copy of the fire behind it: the light it casts in the chamber.
  const lit = (options) =>
    `<g filter="url(#bloom)" opacity="${f(0.75 * flicker)}">${fire({ ...options, width: options.width * 1.25 })}</g>` +
    `<g filter="url(#soft)">${fire(options)}</g>`;
  let chamber = '';
  if (igniting) {
    chamber = ignition(phase);
  } else if (wood) {
    chamber =
      `<ellipse cx="${CX}" cy="${BASE_Y + 4}" rx="78" ry="16" fill="url(#embers)" opacity="${f(0.8 + 0.2 * Math.sin(phase * 2))}"/>` +
      lit({ cx: CX, baseY: BASE_Y - 6, width: 58, height: 118, tongues: 5, phase, spread: 92 }) +
      logs() +
      sparks(phase);
  } else if (level > 0) {
    const [width, height] = FLAME[level];
    chamber = lit({
      cx: CX,
      baseY: BASE_Y,
      width,
      height,
      tongues: 2 + level,
      phase,
      spread: width * 0.7,
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="${VIEW}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b3430"/><stop offset="1" stop-color="#241f1c"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a3f37"/><stop offset="1" stop-color="#2c2521"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1d1e21"/><stop offset="0.5" stop-color="#34363b"/><stop offset="1" stop-color="#1a1b1e"/>
    </linearGradient>
    <linearGradient id="top" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#55585e"/><stop offset="1" stop-color="#2a2c30"/>
    </linearGradient>
    <linearGradient id="chamber" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0c0807"/><stop offset="1" stop-color="${burning ? '#3a1408' : '#16110f'}"/>
    </linearGradient>
    <linearGradient id="flameOuter" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#ff5a1a"/><stop offset="1" stop-color="#c71f0e" stop-opacity="0.6"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.06"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff8a2a" stop-opacity="0.55"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="embers" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb347"/><stop offset="0.6" stop-color="#e2461a"/><stop offset="1" stop-color="#5a1a08" stop-opacity="0"/>
    </radialGradient>
 <radialGradient id="igniter" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb04a"/><stop offset="0.45" stop-color="#e5411a" stop-opacity="0.8"/><stop offset="1" stop-color="#5a1a08" stop-opacity="0"/>
    </radialGradient>
    <filter id="smoke" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5"/></filter>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>
    <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>
    <clipPath id="window"><rect x="${WINDOW.x}" y="${WINDOW.y}" width="${WINDOW.w}" height="${WINDOW.h}" rx="${WINDOW.r}"/></clipPath>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#wall)"/>
  <rect y="392" width="${WIDTH}" height="58" fill="url(#floor)"/>
  <ellipse cx="${CX}" cy="210" rx="${f(260 + 40 * glow)}" ry="${f(200 + 30 * glow)}" fill="url(#glow)" opacity="${f(glow)}"/>

  <!-- hearth plate and shadow -->
  <ellipse cx="${CX}" cy="414" rx="150" ry="14" fill="#000" opacity="0.35"/>
  <rect x="236" y="398" width="328" height="16" rx="4" fill="#5d5650"/>
  <rect x="236" y="398" width="328" height="4" rx="2" fill="#77706a"/>

  <!-- stove body -->
  <rect x="296" y="402" width="16" height="8" rx="2" fill="#141518"/>
  <rect x="488" y="402" width="16" height="8" rx="2" fill="#141518"/>
  <rect x="292" y="58" width="216" height="346" rx="16" fill="url(#body)"/>
  <rect x="286" y="44" width="228" height="22" rx="8" fill="url(#top)"/>
  <rect x="330" y="50" width="140" height="4" rx="2" fill="#1b1c1f"/>
  <rect x="300" y="76" width="200" height="22" rx="6" fill="#26282c"/>
  <circle cx="472" cy="87" r="5" fill="${light}"/>
  <rect x="318" y="83" width="60" height="8" rx="3" fill="${burning || igniting ? '#1f6f8f' : '#2f3236'}" opacity="0.9"/>

  <!-- door: frame, chamber, fire, glass -->
  <rect x="${WINDOW.x - 12}" y="${WINDOW.y - 12}" width="${WINDOW.w + 24}" height="${WINDOW.h + 24}" rx="${WINDOW.r + 8}" fill="#121315"/>
  <rect x="${WINDOW.x}" y="${WINDOW.y}" width="${WINDOW.w}" height="${WINDOW.h}" rx="${WINDOW.r}" fill="url(#chamber)"/>
  <g clip-path="url(#window)">
    <rect x="${CX - 30}" y="${BASE_Y}" width="60" height="16" rx="4" fill="#2b2a2a"/>
    <rect x="${CX - 26}" y="${BASE_Y}" width="52" height="5" rx="2" fill="${burning && !wood ? '#ff6a1a' : '#3b3734'}"/>
    ${chamber}
    <rect x="${WINDOW.x}" y="${WINDOW.y}" width="${WINDOW.w}" height="${WINDOW.h}" fill="url(#glass)"/>
  </g>
  <rect x="${WINDOW.x}" y="${WINDOW.y}" width="${WINDOW.w}" height="${WINDOW.h}" rx="${WINDOW.r}" fill="none" stroke="#3c3f44" stroke-width="2"/>
  <rect x="${WINDOW.x + WINDOW.w + 2}" y="${WINDOW.y + 60}" width="6" height="58" rx="3" fill="#5a5d63"/>

  <!-- lower panel: ash drawer and grille -->
  <rect x="314" y="338" width="172" height="50" rx="8" fill="#1f2023"/>
  ${[0, 1, 2, 3, 4].map((line) => `<rect x="330" y="${348 + line * 8}" width="140" height="3" rx="1.5" fill="#2e3034"/>`).join('')}
</svg>`;
}

async function render(name, variant) {
  const animated = variant.level > 0 || variant.wood || variant.ignition;
  const count = animated ? FRAMES : 1;
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    frames.push(
      await sharp(Buffer.from(frame(variant, index)))
        .png()
        .toBuffer(),
    );
  }
  const image = count === 1 ? sharp(frames[0]) : sharp(frames, { join: { animated: true } });
  const webp = await image
    .webp({
      quality: 72,
      effort: 6,
      ...(count > 1 ? { loop: 0, delay: new Array(count).fill(FRAME_MS) } : {}),
    })
    .toBuffer();
  if (webp.length > MAX_BYTES) {
    throw new Error(
      `${name}: ${Math.round(webp.length / 1024)} KB, over the 300 KB the core accepts`,
    );
  }
  await writeFile(new URL(`../assets/stove-${name}.webp`, import.meta.url), webp);
  return webp.length;
}

await mkdir(new URL('../assets/', import.meta.url), { recursive: true });
for (const [name, variant] of Object.entries(VARIANTS)) {
  const bytes = await render(name, variant);
  console.log(`assets/stove-${name}.webp  ${Math.round(bytes / 1024)} KB`);
}
