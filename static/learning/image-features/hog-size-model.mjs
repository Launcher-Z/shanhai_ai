/* 同一位移、四种划分；比较的是未归一化的区域直方图，不是识别成功率。 */
import { hog } from "./model.mjs";
import {
  shiftIntroImage,
  clampIntroShift,
  cosineSimilarity,
} from "./hog-intro-model.mjs";
export const CELL_SIZES = [4, 8, 16, 24];
const original = shiftIntroImage(0, 0);
const reference = new Map(
  CELL_SIZES.map((size) => [size, hog(original, size).histograms.flat()]),
);
export function sizeComparison(dx = 0, dy = 0) {
  const shift = clampIntroShift(dx, dy),
    changed = shiftIntroImage(shift.dx, shift.dy);
  const scores = Object.fromEntries(
    CELL_SIZES.map((size) => [
      size,
      cosineSimilarity(
        reference.get(size),
        hog(changed, size).histograms.flat(),
      ) * 100,
    ]),
  );
  return { ...shift, original, changed, scores };
}
export function sizeRecord(result) {
  if (!result.dx && !result.dy) return "";
  return [
    `水平位移：${result.dx}`,
    `垂直位移：${result.dy}`,
    ...CELL_SIZES.map(
      (size) => `${size}×${size}：${result.scores[size].toFixed(1)}`,
    ),
  ].join("\n");
}
