/* 科普导入的同形对照：只平移原图，不改轮廓核或HOG参数。 */
import { contours } from './model.mjs';
import { teachingImage, describe } from './hog-model.mjs';

const original = teachingImage('house', 48);
const originalEdge = contours(original, 'both', 100);
const originalFeatures = describe(original).vector;

// 留出两格背景，保证移动中小屋及其轮廓完整，不把裁剪混入实验。
const ink = original.values.flatMap((value, index) => value === original.values[0] ? [] : [{ x:index % original.width, y:Math.floor(index / original.width) }]);
export const INTRO_SHIFT_LIMITS = {
  minX:2 - Math.min(...ink.map(p => p.x)), maxX:original.width - 3 - Math.max(...ink.map(p => p.x)),
  minY:2 - Math.min(...ink.map(p => p.y)), maxY:original.height - 3 - Math.max(...ink.map(p => p.y)),
};

export function clampIntroShift(dx = 0, dy = 0) {
  return {
    dx:Math.max(INTRO_SHIFT_LIMITS.minX, Math.min(INTRO_SHIFT_LIMITS.maxX, Math.round(dx))),
    dy:Math.max(INTRO_SHIFT_LIMITS.minY, Math.min(INTRO_SHIFT_LIMITS.maxY, Math.round(dy))),
  };
}

export function shiftIntroImage(dx = 0, dy = 0) {
  const shift = clampIntroShift(dx, dy);
  // 目标坐标反查来源坐标，背景补同一灰度，不循环、不缩放、不插值。
  return {
    ...original,
    values: original.values.map((_, index) => {
      const sx = index % original.width - shift.dx, sy = Math.floor(index / original.width) - shift.dy;
      return sx >= 0 && sx < original.width && sy >= 0 && sy < original.height
        ? original.values[sy * original.width + sx] : original.values[0];
    }),
  };
}

export function cosineSimilarity(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2;
  }
  if (!aa || !bb) return aa === bb ? 1 : 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(aa * bb)));
}

export function introComparison(dx = 0, dy = 0) {
  const shift = clampIntroShift(dx, dy);
  const shifted = shiftIntroImage(shift.dx, shift.dy), shiftedEdge = contours(shifted, 'both', 100);
  const shiftedFeatures = describe(shifted).vector;
  return {
    ...shift,
    originalEdge, shiftedEdge,
    changedPixels: originalEdge.values.filter((v, i) => v !== shiftedEdge.values[i]).length,
    edgeSimilarity: cosineSimilarity(originalEdge.values, shiftedEdge.values),
    hogSimilarity: cosineSimilarity(originalFeatures, shiftedFeatures),
  };
}
