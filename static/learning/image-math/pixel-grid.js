/* 画布只负责显示与选点；实际图像尺寸、像素值和运算均由 model 提供。 */
export function createPixelGrid(canvas, onSelect) {
  const context = canvas.getContext('2d');
  let config;

  function draw(next) {
    config = next;
    const { image, width, selected, highlights = [], revealed = null, numbers = false, changed = [] } = next;
    const height = width * image.height / image.width;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = false;
    const cell = width / image.width;
    const visible = revealed === null ? null : new Set(revealed);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const index = y * image.width + x;
        const shown = visible === null || visible.has(index);
        const value = image.values[index];
        context.fillStyle = shown ? `rgb(${value.join(',')})` : '#e4e2d9';
        // 相邻色块略重合，避免小数坐标产生细白缝。
        context.fillRect(x * cell, y * cell, cell + .4, cell + .4);
        if (numbers && cell >= 18 && shown) {
          context.fillStyle = value[0]+value[1]+value[2] < 420 ? '#fff' : '#292d28';
          context.font = `${Math.min(9, cell * .28)}px Consolas,monospace`;
          context.textAlign = 'center'; context.textBaseline = 'middle';
          // 格内自上而下列出 R、G、B，与右侧三行读数一致。
          value.forEach((number, channel) => {
            context.fillText(`${['R', 'G', 'B'][channel]}${number}`, (x + .5) * cell, (y + (channel + .5) / 3) * cell);
          });
        }
      }
    }
    if (cell >= 6) {
      context.beginPath(); context.strokeStyle = '#515a492e'; context.lineWidth = .6;
      for (let x = 0; x <= image.width; x++) { context.moveTo(x * cell, 0); context.lineTo(x * cell, height); }
      for (let y = 0; y <= image.height; y++) { context.moveTo(0, y * cell); context.lineTo(width, y * cell); }
      context.stroke();
    }
    function outline(index, color, thickness) {
      const x = index % image.width, y = Math.floor(index / image.width);
      context.strokeStyle = color; context.lineWidth = thickness;
      context.strokeRect(x * cell + thickness / 2, y * cell + thickness / 2, cell - thickness, cell - thickness);
    }
    changed.forEach(index => outline(index, '#9a594c', Math.min(1.6, cell / 4)));
    highlights.forEach(index => outline(index, '#8a603a', Math.min(2, cell / 4)));
    if (selected) {
      const index = selected.y * image.width + selected.x;
      outline(index, '#fff9de', Math.min(4, cell / 2));
      outline(index, '#315f57', Math.min(2, cell / 3));
    }
  }

  function choose(x, y) {
    if (!config) return;
    const { image } = config;
    onSelect(Math.max(0, Math.min(image.width - 1, x)), Math.max(0, Math.min(image.height - 1, y)));
  }
  canvas.addEventListener('click', event => {
    if (!config) return;
    const box = canvas.getBoundingClientRect();
    choose(Math.floor((event.clientX - box.left) / box.width * config.image.width),
      Math.floor((event.clientY - box.top) / box.height * config.image.height));
  });
  canvas.addEventListener('keydown', event => {
    if (!config) return;
    const current = config.selected || { x: 0, y: 0 };
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key in moves) {
      event.preventDefault();
      const [dx, dy] = moves[event.key]; choose(current.x + dx, current.y + dy);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); choose(event.key === 'Home' ? 0 : config.image.width - 1, current.y);
    }
  });
  return { draw };
}
