/**
 * Human-like input simulation utilities.
 * Mouse movement algorithm ported from riflosnake/HumanCursor (Python).
 *
 * Key differences from a naive cubic bezier:
 * - Variable-degree Bernstein polynomial Bézier (degree = knots + 1)
 * - Random easing function selection from 13 pytweening-style options
 * - Gaussian Y-axis noise with configurable frequency
 * - Distance-aware control point distribution with random offset boundaries
 * - Weighted random knot count (51% chance of 1–2 knots)
 */

import type {Page} from '../third_party/index.js';

// ─── Random utilities ────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.round(rand(min, max));
}

/**
 * Box-Muller transform for Gaussian random numbers.
 */
function gaussianRandom(mean = 0, stddev = 1): number {
  let u: number, v: number, s: number;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  return mean + stddev * u * mul;
}

// ─── Easing functions (ported from pytweening) ───────────────────────

type EasingFn = (t: number) => number;

function easeLinear(t: number): number {
  return t;
}

function easeInQuad(t: number): number {
  return t * t;
}

function easeOutQuad(t: number): number {
  return -t * (t - 2);
}

function easeInOutQuad(t: number): number {
  if (t < 0.5) return 2 * t * t;
  t = t * 2 - 1;
  return -0.5 * (t * (t - 2) - 1);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function easeOutCubic(t: number): number {
  t -= 1;
  return t * t * t + 1;
}

function easeInOutCubic(t: number): number {
  t *= 2;
  if (t < 1) return 0.5 * t * t * t;
  t -= 2;
  return 0.5 * (t * t * t + 2);
}

function easeInQuart(t: number): number {
  return t * t * t * t;
}

function easeOutQuart(t: number): number {
  t -= 1;
  return -(t * t * t * t - 1);
}

function easeInOutQuart(t: number): number {
  t *= 2;
  if (t < 1) return 0.5 * t * t * t * t;
  t -= 2;
  return -0.5 * (t * t * t * t - 2);
}

function easeInQuint(t: number): number {
  return t * t * t * t * t;
}

function easeOutQuint(t: number): number {
  t -= 1;
  return t * t * t * t * t + 1;
}

function easeInOutQuint(t: number): number {
  t *= 2;
  if (t < 1) return 0.5 * t * t * t * t * t;
  t -= 2;
  return 0.5 * (t * t * t * t * t + 2);
}

function easeOutExpo(t: number): number {
  if (t === 1) return 1;
  return -Math.pow(2, -10 * t) + 1;
}

const EASING_FUNCTIONS: EasingFn[] = [
  easeLinear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,
  easeInQuint,
  easeOutQuint,
  easeInOutQuint,
  easeOutExpo,
];

function pickEasing(): EasingFn {
  return EASING_FUNCTIONS[Math.floor(Math.random() * EASING_FUNCTIONS.length)];
}

// ─── Bernstein polynomial Bézier ─────────────────────────────────────

/**
 * Binomial coefficient C(n, k).
 */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

/**
 * Evaluate a Bézier curve of arbitrary degree at parameter t.
 * Uses Bernstein polynomial basis: B(t) = Σ C(n,i) * (1-t)^(n-i) * t^i * P_i
 *
 * @param t - Parameter in [0, 1]
 * @param controlPoints - Array of control point values (1D)
 */
function bernsteinBezier(t: number, controlPoints: number[]): number {
  const n = controlPoints.length - 1;
  let result = 0;
  for (let i = 0; i <= n; i++) {
    result +=
      binomial(n, i) *
      Math.pow(1 - t, n - i) *
      Math.pow(t, i) *
      controlPoints[i];
  }
  return result;
}

// ─── Knot generation (HumanCursor algorithm) ─────────────────────────

/**
 * Weighted random knot count.
 * HumanCursor uses: 51% chance of 1-2 knots, rest distributed 3-5.
 */
function pickKnotCount(): number {
  const r = Math.random();
  if (r < 0.25) return 1;
  if (r < 0.51) return 2;
  if (r < 0.70) return 3;
  if (r < 0.88) return 4;
  return 5;
}

/**
 * Generate internal knot points between start and end.
 * Knots are spaced along the path with random perpendicular offsets.
 */
function generateKnots(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  count: number,
): Array<{x: number; y: number}> {
  const knots: Array<{x: number; y: number}> = [];
  const offsetBoundary = randInt(20, 100);

  for (let i = 1; i <= count; i++) {
    const fraction = i / (count + 1);
    // Interpolated position along the line
    const baseX = fromX + (toX - fromX) * fraction;
    const baseY = fromY + (toY - fromY) * fraction;
    // Random offset perpendicular to the path direction
    knots.push({
      x: baseX + rand(-offsetBoundary, offsetBoundary),
      y: baseY + rand(-offsetBoundary, offsetBoundary),
    });
  }
  return knots;
}

// ─── Distortion (Gaussian noise on Y-axis) ───────────────────────────

interface DistortionConfig {
  mean: number;
  stddev: number;
  frequency: number;
}

/**
 * Apply Gaussian noise distortion to path points.
 * HumanCursor applies distortion to the Y-axis with configurable frequency.
 */
function applyDistortion(
  points: Array<{x: number; y: number}>,
  config: DistortionConfig,
): Array<{x: number; y: number}> {
  return points.map(p => {
    if (Math.random() < config.frequency) {
      return {
        x: p.x,
        y: p.y + gaussianRandom(config.mean, config.stddev),
      };
    }
    return p;
  });
}

// ─── Mouse path generation ───────────────────────────────────────────

/**
 * Generate a human-like mouse path using HumanCursor's algorithm:
 * 1. Pick random knot count (weighted)
 * 2. Generate knots with random offsets
 * 3. Build control points: [start, ...knots, end]
 * 4. Evaluate Bernstein Bézier at distance-aware number of points
 * 5. Apply easing function for speed variation
 * 6. Apply Gaussian Y-axis distortion
 */
function generateMousePath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Array<{x: number; y: number}> {
  const knotCount = pickKnotCount();
  const knots = generateKnots(fromX, fromY, toX, toY, knotCount);

  // Control points for Bernstein Bézier: start + knots + end
  const cpX = [fromX, ...knots.map(k => k.x), toX];
  const cpY = [fromY, ...knots.map(k => k.y), toY];

  // Distance-aware point count (HumanCursor: max(|dx|, |dy|, 2))
  const midPtsCnt = Math.max(
    Math.round(Math.abs(toX - fromX)),
    Math.round(Math.abs(toY - fromY)),
    2,
  );

  // Random easing function
  const ease = pickEasing();

  // Generate raw Bézier points with easing
  const rawPoints: Array<{x: number; y: number}> = [];
  for (let i = 0; i <= midPtsCnt; i++) {
    const linearT = i / midPtsCnt;
    const t = ease(linearT);
    rawPoints.push({
      x: bernsteinBezier(t, cpX),
      y: bernsteinBezier(t, cpY),
    });
  }

  // Apply two rounds of distortion (HumanCursor applies distortionMean/distortionStdev/distortionFrequency)
  const distortion1: DistortionConfig = {
    mean: rand(0.8, 1.1),
    stddev: rand(0.8, 1.1),
    frequency: rand(0.4, 0.6),
  };
  const distortion2: DistortionConfig = {
    mean: rand(0.8, 1.1),
    stddev: rand(0.8, 1.1),
    frequency: rand(0.4, 0.6),
  };

  let points = applyDistortion(rawPoints, distortion1);
  points = applyDistortion(points, distortion2);

  // Round to integers and deduplicate consecutive identical points
  const rounded: Array<{x: number; y: number}> = [];
  for (const p of points) {
    const rx = Math.round(p.x);
    const ry = Math.round(p.y);
    const last = rounded[rounded.length - 1];
    if (!last || last.x !== rx || last.y !== ry) {
      rounded.push({x: rx, y: ry});
    }
  }

  return rounded;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Move mouse along a human-like path to the target coordinates.
 */
export async function humanMouseMove(
  page: Page,
  toX: number,
  toY: number,
  fromX?: number,
  fromY?: number,
): Promise<void> {
  const startX = fromX ?? randInt(100, 400);
  const startY = fromY ?? randInt(100, 300);

  const path = generateMousePath(startX, startY, toX, toY);

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    // Small random delay between moves (yields to event loop)
    if (Math.random() < 0.3) {
      await new Promise(r => setTimeout(r, randInt(1, 4)));
    }
  }
}

/**
 * Human-like click: move to target with random offset, pause, then click.
 */
export async function humanClick(
  page: Page,
  x: number,
  y: number,
  options?: {button?: 'left' | 'right' | 'middle'; clickCount?: number},
): Promise<void> {
  // Random offset from exact center (humans don't click dead center)
  const offsetX = rand(-3, 3);
  const offsetY = rand(-3, 3);
  const targetX = Math.round(x + offsetX);
  const targetY = Math.round(y + offsetY);

  await humanMouseMove(page, targetX, targetY);

  // Brief pause before clicking (human reaction time)
  await new Promise(r => setTimeout(r, randInt(30, 120)));

  await page.mouse.click(targetX, targetY, {
    button: options?.button ?? 'left',
    clickCount: options?.clickCount ?? 1,
  });
}

/**
 * Human-like click on a selector: get bounding box, then humanClick.
 */
export async function humanClickSelector(
  page: Page,
  selector: string,
  options?: {button?: 'left' | 'right' | 'middle'; clickCount?: number},
): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`Element "${selector}" not found or not visible.`);
  }

  // Random point within element bounds (not center)
  const x = box.x + box.width * rand(0.3, 0.7);
  const y = box.y + box.height * rand(0.3, 0.7);

  await humanClick(page, x, y, options);
}

// ─── Keyboard layout for digraph timing ──────────────────────────────

/** Approximate QWERTY keyboard columns (0-indexed from left). */
const KEY_COL: Record<string, number> = {};
const KEY_ROW: Record<string, number> = {};
const KEY_HAND: Record<string, 'L' | 'R'> = {};
const ROWS = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];
for (let r = 0; r < ROWS.length; r++) {
  for (let c = 0; c < ROWS[r].length; c++) {
    const ch = ROWS[r][c];
    KEY_ROW[ch] = r;
    KEY_COL[ch] = c;
    // Left hand: columns 0-5 (up to T/G/B), right hand: 6+
    KEY_HAND[ch] = c <= 5 ? 'L' : 'R';
  }
}

/** Keys that are commonly mistyped for a given key (adjacent keys in 3x3 grid). */
function getAdjacentKeys(ch: string): string[] {
  const row = KEY_ROW[ch.toLowerCase()];
  const col = KEY_COL[ch.toLowerCase()];
  if (row === undefined || col === undefined) return [];
  const adjacent: string[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < ROWS.length && c >= 0 && c < ROWS[r].length) {
        adjacent.push(ROWS[r][c]);
      }
    }
  }
  return adjacent;
}

/**
 * Compute inter-key delay factor based on digraph (key pair) characteristics.
 * Same-hand consecutive keys are slower; alternating hands are faster.
 * Same-finger (same column, same hand) is slowest.
 */
function digraphFactor(prev: string, curr: string): number {
  const pHand = KEY_HAND[prev.toLowerCase()];
  const cHand = KEY_HAND[curr.toLowerCase()];
  const pCol = KEY_COL[prev.toLowerCase()];
  const cCol = KEY_COL[curr.toLowerCase()];

  if (pHand === undefined || cHand === undefined) return 1.0;

  // Alternating hands — fastest
  if (pHand !== cHand) return rand(0.7, 0.9);

  // Same hand, same finger (same column) — slowest
  if (pCol === cCol) return rand(1.3, 1.7);

  // Same hand, different finger
  return rand(1.0, 1.3);
}

/**
 * Human-like typing with realistic timing characteristics:
 * - Digraph-aware delays (same-hand vs alternating-hand timing)
 * - Word boundary pauses (space/punctuation triggers longer delay)
 * - Occasional typos with backspace correction (~3% per char)
 * - Key hold time variation (keydown→keyup gap)
 * - Gaussian-distributed base delays instead of uniform
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  baseDelay = 80,
): Promise<void> {
  // Click into the field first with human-like mouse movement
  await humanClickSelector(page, selector);
  await new Promise(r => setTimeout(r, randInt(50, 150)));

  let prevChar = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // ── Typo simulation (~3% chance, only for lowercase letters) ──
    if (
      Math.random() < 0.03 &&
      /^[a-z]$/.test(char) &&
      getAdjacentKeys(char).length > 0
    ) {
      const typoKeys = getAdjacentKeys(char);
      const typo = typoKeys[Math.floor(Math.random() * typoKeys.length)];

      // Type wrong key
      await page.keyboard.press(typo);
      await new Promise(r => setTimeout(r, randInt(40, 120)));

      // Brief pause (noticing the mistake)
      await new Promise(r => setTimeout(r, randInt(100, 300)));

      // Backspace to correct
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, randInt(50, 150)));
    }

    // ── Key hold time (keydown → keyup gap) ──
    const holdTime = randInt(30, 90);
    await page.keyboard.down(char);
    await new Promise(r => setTimeout(r, holdTime));
    await page.keyboard.up(char);

    // ── Inter-key delay ──
    // Gaussian-distributed base delay
    const gaussDelay = Math.max(20, gaussianRandom(baseDelay, baseDelay * 0.3));

    // Digraph factor: same-hand slower, alternating faster
    const dFactor = prevChar ? digraphFactor(prevChar, char) : 1.0;

    // Word boundary: longer pause after space or punctuation
    let boundaryPause = 0;
    if (char === ' ') {
      boundaryPause = randInt(20, 80);
    } else if (/[.,;:!?]/.test(char)) {
      boundaryPause = randInt(40, 150);
    }

    // Occasional hesitation (thinking pause, ~4%)
    const thinkPause = Math.random() < 0.04 ? randInt(200, 500) : 0;

    const totalDelay = Math.round(gaussDelay * dFactor) + boundaryPause + thinkPause;
    await new Promise(r => setTimeout(r, totalDelay));

    prevChar = char;
  }
}

/**
 * Human-like scroll: gradual scrolling with deceleration.
 */
export async function humanScroll(
  page: Page,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const totalSteps = randInt(4, 8);
  let remainX = deltaX;
  let remainY = deltaY;

  for (let i = 0; i < totalSteps; i++) {
    // Decreasing portion each step (deceleration)
    const fraction = (totalSteps - i) / ((totalSteps * (totalSteps + 1)) / 2);
    const stepX = Math.round(deltaX * fraction + rand(-2, 2));
    const stepY = Math.round(deltaY * fraction + rand(-2, 2));

    const actualX = Math.abs(stepX) > Math.abs(remainX) ? remainX : stepX;
    const actualY = Math.abs(stepY) > Math.abs(remainY) ? remainY : stepY;

    await page.mouse.wheel(actualX, actualY);
    remainX -= actualX;
    remainY -= actualY;

    await new Promise(r => setTimeout(r, randInt(30, 80)));
  }

  // Final adjustment if any remainder
  if (remainX !== 0 || remainY !== 0) {
    await page.mouse.wheel(remainX, remainY);
  }
}
