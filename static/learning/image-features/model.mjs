/* 两项活动共用灰度数组；轮廓与 HOG 分别从灰度图计算。 */
export const KERNELS = {
  x: { name: '左右变化', values: [1, 0, -1, 1, 0, -1, 1, 0, -1] },
  y: { name: '上下变化', values: [1, 1, 1, 0, 0, 0, -1, -1, -1] },
};

// 扩展实验的系数与显示规则一起保存，避免悄悄修改学生设计的结果。
export const CUSTOM_KERNELS = {
  blur: { name:'均值模糊', values:[1,1,1,1,1,1,1,1,1], divisor:9, offset:0, absolute:false },
  sharpen: { name:'锐化', values:[0,-1,0,-1,5,-1,0,-1,0], divisor:1, offset:0, absolute:false },
  emboss: { name:'浮雕', values:[-2,-1,0,-1,1,1,0,1,2], divisor:1, offset:128, absolute:false },
  edge: { name:'边缘提取', values:[-1,-1,-1,-1,8,-1,-1,-1,-1], divisor:1, offset:0, absolute:true },
};

export function customKernelAt(gray, x, y, config) {
  return windowAt(gray, x, y).reduce((sum, value, i) => sum + value * config.values[i], 0);
}

export function customKernelValue(sum, config) {
  let value = sum / config.divisor;
  if (config.absolute) value = Math.abs(value);
  // 使用同一规则处理整图和选中像素，原始求和仍在实验台上保留。
  return Math.max(0, Math.min(255, Math.round(value + config.offset)));
}

export function filterCustomKernel(gray, config) {
  return { width:gray.width, height:gray.height, values:gray.values.map((_, i) =>
    customKernelValue(customKernelAt(gray, i % gray.width, Math.floor(i / gray.width), config), config)) };
}

export function createSample(kind = 'house', size = 24) {
  const values = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let ink = false;
      if (kind === 'house') ink = (v > .43 && v < .85 && u > .25 && u < .75) || (v > .15 && v <= .43 && Math.abs(u - .5) < (v - .15));
      if (kind === 'vertical') ink = u > .46;
      if (kind === 'horizontal') ink = v > .46;
      if (kind === 'diagonal') ink = u > v;
      if (kind === 'house' && v > .6 && u > .43 && u < .57) ink = false;
      values.push(ink ? [35, 55, 53] : [240, 235, 217]);
    }
  }
  return { width: size, height: size, values };
}

export function grayscale(image) {
  return { width: image.width, height: image.height,
    values: image.values.map(([r, g, b]) => Math.round(.299 * r + .587 * g + .114 * b)) };
}

// 滑窗在边缘重复最近的像素，输出与原图同宽高。
export function windowAt(image, x, y) {
  const cells = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sx = Math.max(0, Math.min(image.width - 1, x + dx));
      const sy = Math.max(0, Math.min(image.height - 1, y + dy));
      cells.push(image.values[sy * image.width + sx]);
    }
  }
  return cells;
}

export function convolveAt(image, x, y, axis) {
  return windowAt(image, x, y).reduce((sum, v, i) => sum + v * KERNELS[axis].values[i], 0);
}

export function contours(gray, axis = 'both', threshold = 100) {
  const values = gray.values.map((_, i) => {
    const x = i % gray.width, y = Math.floor(i / gray.width);
    const gx = convolveAt(gray, x, y, 'x'), gy = convolveAt(gray, x, y, 'y');
    const strength = axis === 'both' ? Math.hypot(gx, gy) : Math.abs(axis === 'x' ? gx : gy);
    return strength >= threshold ? 255 : 0;
  });
  return { width: gray.width, height: gray.height, values };
}

export function gradientAt(gray, x, y) {
  const at = (dx, dy) => gray.values[Math.max(0, Math.min(gray.height - 1, y + dy)) * gray.width + Math.max(0, Math.min(gray.width - 1, x + dx))];
  const gx = at(1, 0) - at(-1, 0), gy = at(0, -1) - at(0, 1);
  const magnitude = Math.hypot(gx, gy);
  const angle = (Math.atan2(gy, gx) * 180 / Math.PI + 180) % 180;
  // 教学版使用最近方向投票，保留幅值加权；0°与180°视为同方向。
  return { gx, gy, magnitude, angle, bin: Math.round(angle / 20) % 9 };
}

export function hog(gray, cellSize = 8) {
  const columns = Math.floor(gray.width / cellSize), rows = Math.floor(gray.height / cellSize);
  const histograms = Array.from({ length: columns * rows }, () => Array(9).fill(0));
  for (let y = 0; y < rows * cellSize; y++) {
    for (let x = 0; x < columns * cellSize; x++) {
      const g = gradientAt(gray, x, y);
      histograms[Math.floor(y / cellSize) * columns + Math.floor(x / cellSize)][g.bin] += g.magnitude;
    }
  }
  const vector = [], blocks = [];
  // 2×2 小区域组成一个块，逐块 L2 归一化后按行拼接。
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < columns - 1; x++) {
      const block = [y * columns + x, y * columns + x + 1, (y + 1) * columns + x, (y + 1) * columns + x + 1].flatMap(i => histograms[i]);
      const norm = Math.sqrt(block.reduce((sum, v) => sum + v * v, 0) + 1e-10);
      const values = block.map(v => v / norm);
      // 暴露同一次真实计算的来源，供学生从特征数字反查重叠块。
      blocks.push({ x, y, cells:[y * columns + x, y * columns + x + 1, (y + 1) * columns + x, (y + 1) * columns + x + 1], raw:block, norm, values, offset:vector.length });
      vector.push(...values);
    }
  }
  return { columns, rows, histograms, vector, blocks, cellSize };
}
