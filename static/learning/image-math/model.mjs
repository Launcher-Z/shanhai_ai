/* 图像统一使用 8 位 RGB 三通道；每种运算分别处理三个颜色数值。 */
export function createMountain() {
  // 保留原图前 15 行，去掉水面最下方的 3 行；不缩放上面的山、云和夕阳。
  const width = 24, height = 15;
  const ridge = [10, 10, 9, 8, 7, 5, 3, 4, 5, 6, 7, 8, 8, 7, 6, 7, 8, 9, 10, 11, 11, 11, 11, 11];
  const sky = [[101,108,160],[123,119,165],[145,130,171],[170,143,175],[194,155,174],[218,168,172],[236,183,169],[246,197,171],[250,209,182],[251,218,193],[247,224,204],[240,224,207]];
  const values = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = [...sky[Math.min(y, 11)]];
      // 日落、云、山、水和倒影都由真实像素数组组成，不叠加装饰图片。
      if ((x - 18) ** 2 + (y - 6) ** 2 <= 8) value = [255, 217, 139];
      if ((y === 2 && x >= 2 && x <= 5) || (y === 3 && x >= 1 && x <= 7) || (y === 1 && x >= 10 && x <= 13)) value = [241, 222, 218];
      if (y >= ridge[x] && y < 12) {
        if (y <= ridge[x] + 1 && x >= 4 && x <= 8) value = [234, 224, 221];
        else if (x <= 6) value = [112, 105, 139];
        else if (x <= 11) value = [64, 78, 112];
        else value = [106, 116, 139];
      }
      if (y >= 12) {
        value = [75 + (y - 12) * 6, 127 + (y - 12) * 4, 151 + (y - 12) * 3];
        if (x >= 16 - (y % 2) && x <= 20 + (y % 2)) value = y % 2 ? [226, 186, 147] : [244, 206, 160];
        if (y % 2 === 0 && x >= 2 && x <= 10) value = [125, 161, 174];
      }
      values.push([...value]);
    }
  }
  return { width, height, values };
}

export function binary8(value) {
  return value.toString(2).padStart(8, '0');
}

export function sourceForEnlarged(x, y, factor) {
  return { x: Math.floor(x / factor), y: Math.floor(y / factor) };
}

export function enlargeNearest(image, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new Error('放大倍数必须是正整数。');
  const width = image.width * factor, height = image.height * factor;
  const values = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = sourceForEnlarged(x, y, factor);
      values.push([...image.values[source.y * image.width + source.x]]);
    }
  }
  return { width, height, values };
}

export function meanBlock(image, x, y, size) {
  const cells = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const column = x * size + dx, row = y * size + dy;
      cells.push({ x: column, y: row, value: image.values[row * image.width + column] });
    }
  }
  const sum = [0, 1, 2].map(channel => cells.reduce((total, cell) => total + cell.value[channel], 0));
  const mean = sum.map(value => value / cells.length);
  return { cells, sum, mean, rounded: mean.map(Math.round) };
}

export function shrinkMean(image, size) {
  if (!Number.isInteger(size) || size < 1 || image.width % size || image.height % size) {
    throw new Error('区块边长必须是正整数，且原图宽高都能被它整除。');
  }
  const width = image.width / size, height = image.height / size;
  const values = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) values.push(meanBlock(image, x, y, size).rounded);
  }
  return { width, height, values };
}

export function compareImages(original, result) {
  if (original.width !== result.width || original.height !== result.height) {
    throw new Error('比较的两幅图像必须具有相同的像素尺寸。');
  }
  const changed = [];
  original.values.forEach((value, index) => {
    if (value.some((channel, c) => channel !== result.values[index][c])) changed.push(index);
  });
  return { changed, total: original.values.length };
}

export function bilinearDetail(image, x, y, factor) {
  // 采用半像素中心映射；边界坐标夹到最近边缘，RGB 分别加权并四舍五入。
  const sx = Math.max(0, Math.min(image.width - 1, (x + .5) / factor - .5));
  const sy = Math.max(0, Math.min(image.height - 1, (y + .5) / factor - .5));
  const x0 = Math.floor(sx), y0 = Math.floor(sy);
  const x1 = Math.min(image.width - 1, x0 + 1), y1 = Math.min(image.height - 1, y0 + 1);
  const dx = sx - x0, dy = sy - y0;
  const cells = [[x0,y0,(1-dx)*(1-dy)],[x1,y0,dx*(1-dy)],[x0,y1,(1-dx)*dy],[x1,y1,dx*dy]]
    .filter(([, , weight]) => weight > 0)
    .map(([x,y,weight]) => ({ x,y,weight,value:image.values[y*image.width+x] }));
  const rounded = [0,1,2].map(c => Math.round(cells.reduce((sum, cell) => sum + cell.value[c] * cell.weight, 0)));
  return { cells, rounded, source: { x:x0,y:y0 } };
}

export function enlargeBilinear(image, factor) {
  if (!Number.isInteger(factor) || factor < 1) throw new Error('放大倍数必须是正整数。');
  const width = image.width * factor, height = image.height * factor;
  const values = [];
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) values.push(bilinearDetail(image,x,y,factor).rounded);
  return {width,height,values};
}
