/**
 * Human-like input simulation utilities.
 * Inspired by Camoufox's HumanCursor algorithm.
 */

import type {Page} from '../third_party/index.js';

/**
 * Generate a random number in [min, max].
 */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Generate a random integer in [min, max].
 */
function randInt(min: number, max: number): number {
  return Math.round(rand(min, max));
}

/**
 * Evaluate a cubic bezier curve at parameter t.
 */
function bezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number,
): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * Generate a human-like mouse path using cubic bezier curves.
 * Returns an array of {x, y} points.
 */
function generateMousePath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Array<{x: number; y: number}> {
  const distance = Math.hypot(toX - fromX, toY - fromY);

  // Number of steps scales with distance
  const steps = Math.max(10, Math.min(80, Math.round(distance / 8)));

  // Random control points for bezier curve (creates natural arc)
  const spread = Math.max(30, distance * 0.3);
  const cp1x = fromX + (toX - fromX) * rand(0.2, 0.4) + rand(-spread, spread) * 0.5;
  const cp1y = fromY + (toY - fromY) * rand(0.2, 0.4) + rand(-spread, spread) * 0.5;
  const cp2x = fromX + (toX - fromX) * rand(0.6, 0.8) + rand(-spread, spread) * 0.3;
  const cp2y = fromY + (toY - fromY) * rand(0.6, 0.8) + rand(-spread, spread) * 0.3;

  const points: Array<{x: number; y: number}> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ease-in-out timing for more natural speed
    const ease = t < 0.5
      ? 2 * t * t
      : 1 - Math.pow(-2 * t + 2, 2) / 2;

    points.push({
      x: Math.round(bezier(ease, fromX, cp1x, cp2x, toX)),
      y: Math.round(bezier(ease, fromY, cp1y, cp2y, toY)),
    });
  }

  return points;
}

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
  // Default start position: current or random near-center
  const startX = fromX ?? randInt(100, 400);
  const startY = fromY ?? randInt(100, 300);

  const path = generateMousePath(startX, startY, toX, toY);

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    // Small random delay between moves (1-4ms, mostly just yields)
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

/**
 * Human-like typing with random delays between keystrokes.
 * baseDelay is the average delay; actual delays vary ±50%.
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  baseDelay = 80,
): Promise<void> {
  // Click into the field first
  await humanClickSelector(page, selector);
  await new Promise(r => setTimeout(r, randInt(50, 150)));

  for (const char of text) {
    // Random delay: varies around baseDelay
    const delay = randInt(
      Math.round(baseDelay * 0.5),
      Math.round(baseDelay * 1.8),
    );

    // Occasional longer pause (thinking/hesitation)
    const pause = Math.random() < 0.05 ? randInt(200, 500) : 0;

    await page.keyboard.type(char, {delay: 0});
    await new Promise(r => setTimeout(r, delay + pause));
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
