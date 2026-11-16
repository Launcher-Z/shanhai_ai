/* HOG 的课堂对照材料；所有图和柱形都由同一份真实像素计算。 */
import { createSample, grayscale, hog } from "./model.mjs";

export function teachingImage(kind = "vertical", size = 24) {
  if (kind === "layout-a" || kind === "layout-b") {
    // 图案离格边至少一格，交换完整单元格后，全图方向总量不变。
    const values = Array(size * size).fill(224),
      cellSize = size / 3;
    const cells =
      kind === "layout-a"
        ? [
            [0, 0, "v"],
            [2, 2, "h"],
          ]
        : [
            [2, 0, "h"],
            [0, 2, "v"],
          ];
    for (const [cx, cy, shape] of cells) {
      for (let y = 0; y < cellSize; y++)
        for (let x = 0; x < cellSize; x++) {
          const dark =
            shape === "v"
              ? x >= 3 && x <= 4 && y >= 1 && y <= 6
              : y >= 3 && y <= 4 && x >= 1 && x <= 6;
          if (dark) values[(cy * cellSize + y) * size + cx * cellSize + x] = 32;
        }
    }
    return { width: size, height: size, values };
  }
  return grayscale(createSample(kind, size));
}

export function invertGray(gray) {
  return { ...gray, values: gray.values.map((v) => 255 - v) };
}

export function contrastGray(gray, percent) {
  // 围绕128缩放灰度差，0%—100%不会截断；保留浮点以排除量化误差。
  return {
    ...gray,
    values: gray.values.map((v) => 128 + ((v - 128) * percent) / 100),
  };
}

export function globalHistogram(descriptor) {
  return descriptor.histograms.reduce(
    (total, hist) => total.map((v, i) => v + hist[i]),
    Array(9).fill(0),
  );
}

export function histogramVotes(gray, cellSize, cellIndex, gradientAt) {
  const columns = Math.floor(gray.width / cellSize);
  const left = (cellIndex % columns) * cellSize,
    top = Math.floor(cellIndex / columns) * cellSize;
  return Array.from({ length: cellSize * cellSize }, (_, i) => {
    const x = left + (i % cellSize),
      y = top + Math.floor(i / cellSize);
    return { x, y, ...gradientAt(gray, x, y) };
  });
}

export function describe(gray) {
  return hog(gray, 8);
}
