/* 活动二：同一份像素数据，依次用于灰度、两个方向的卷积与合并。 */
import { createSample, grayscale, windowAt, convolveAt, contours, KERNELS,
  CUSTOM_KERNELS, customKernelAt, customKernelValue, filterCustomKernel } from './model.mjs';
import { createExperimentStorage } from '../experiment-storage.js';

const STEPS = [
  ['颜色褪去，数字怎样变少？', '处理一个像素：读取三个颜色数值，计算，再把灰度填到右图。', '像素数量没有变；每个像素从三个颜色数值，变成一个灰度数值。'],
  ['沿横向，寻找左右的变化', '换成横边、竖边对照：这个核更容易留下哪一种边？', '横向卷积核比较左右变化，通常突出竖直边缘。'],
  ['沿纵向，寻找上下的变化', '保持同一张图，观察换一个方向后留下了什么。', '纵向卷积核比较上下变化，通常突出水平边缘。'],
  ['合起来，再决定留下多少', '点击任一图选择像素，再拖动滑条观察。', '门槛低：保留更多细节；门槛高：只留下较强变化。'],
  ['设计我的卷积核 · 选做', '选一个预制核，或改动九个数后点击“应用”。', '改变中间格、周围格或正负号，会发生什么？'],
];

function coloredSample(kind) {
  const picture = createSample(kind);
  // 图形结构保持简单，但颜色有明显差别，让灰度转换前后可直接比较。
  picture.values = picture.values.map((rgb, i) => {
    const x = i % picture.width, y = Math.floor(i / picture.width);
    const ink = rgb[0] === 35;
    if (kind !== 'house') return ink ? [247, 174, 53] : [27, 74, 151];
    if (ink) return y < 11 ? [219, 62, 48] : [249, 186, 54];
    if (y > 14 && x > 10 && x < 14) return [45, 99, 149];
    return y > 19 ? [55, 151, 79] : [66 + y * 3, 168 + y * 2, 231];
  });
  return picture;
}

export function mountImageEdge(root, onStepChange = () => {}) {
  const ui = name => root.querySelector(`[data-edge-ui="${name}"]`);
  const button = name => root.querySelector(`[data-edge-action="${name}"]`);
  const source = root.querySelector('[data-edge-canvas="source"]');
  const result = root.querySelector('[data-edge-canvas="result"]');
  const directionX = root.querySelector('[data-edge-canvas="direction-x"]');
  const directionY = root.querySelector('[data-edge-canvas="direction-y"]');
  let image = coloredSample('horizontal'), gray = grayscale(image);
  let allowedSteps = null;
  const canEnter = next => !allowedSteps || allowedSteps.has(next);
  let selected = 0, step = 0, threshold = 100, sample = 'horizontal';
  let filled = new Set(), phase = 0, timer = null, running = '', loadVersion = 0;
  const kernelFilled = { x:new Set(), y:new Set(), custom:new Set() };
  const kernelPlans = { x:null, y:null };
  let activeAutoAxis = null;
  const KERNEL_AUTO_MS = 60000, KERNEL_FIRST_MS = 4100;
  let strengthImages = {};
  let kernelState = { index:-1, axis:'x', count:0, stage:'read' };
  let customConfig = { ...CUSTOM_KERNELS.blur, values:[...CUSTOM_KERNELS.blur.values] };
  let customOutput = null;
  let customDirty = false;
  const customField = name => root.querySelector(`[data-edge-custom="${name}"]`);
  const coefficientInputs = [...root.querySelectorAll('[data-edge-coefficient]')];
  let restoring = false;
  const storage = createExperimentStorage(root, 'lesson-6-task-2', () => restoring ? null : ({
    step, sample, selected, threshold, filled: [...filled], phase,
    kernelFilled: Object.fromEntries(Object.entries(kernelFilled).map(([axis, items]) => [axis, [...items]])),
    kernelState, customConfig, customDirty,
    customDraft: { preset: customField('preset').value, values: coefficientInputs.map(input => input.value),
      divisor: customField('divisor').value, offset: customField('offset').value, absolute: customField('absolute').checked },
  }));
  root.classList.add('feature-edge');

  function pause() {
    if (activeAutoAxis) {
      const plan = kernelPlans[activeAutoAxis];
      plan.elapsed += performance.now() - plan.started;
      activeAutoAxis = null;
    }
    clearTimeout(timer); clearInterval(timer); timer = null; running = '';
    button('auto').textContent = '自动填充'; button('scan').textContent = '自动继续';
    button('kernel-play').textContent = '逐格演示';
    button('apply').disabled = false;
  }

  function position() { return { x: selected % image.width, y: Math.floor(selected / image.width) }; }
  function currentAxis() { return step === 4 ? 'custom' : step === 1 ? 'x' : 'y'; }
  function strength(axis) {
    // 同一图片的结果只计算一次；演示仅逐格揭示，避免每一帧重复运算整张图。
    strengthImages[axis] ||= { width:gray.width, height:gray.height, values:gray.values.map((_, i) =>
      Math.round(Math.abs(convolveAt(gray, i % gray.width, Math.floor(i / gray.width), axis)) / 3)) };
    return strengthImages[axis];
  }

  function draw(canvas, picture, isResult) {
    const ctx = canvas.getContext('2d'), unit = canvas.width / image.width;
    ctx.imageSmoothingEnabled = false;
    picture.values.forEach((value, i) => {
      const col = i % image.width, row = Math.floor(i / image.width);
      const empty = isResult && (step === 0 ? !filled.has(i)
        : step < 3 ? !kernelFilled[step === 1 ? 'x' : 'y'].has(i) : false);
      ctx.fillStyle = empty ? (step === 0 && (col + row) % 2 ? '#e2e4dc' : '#eff0e9')
        : Array.isArray(value) ? `rgb(${value.join(',')})` : `rgb(${value},${value},${value})`;
      ctx.fillRect(col * unit, row * unit, unit + .2, unit + .2);
    });
    // 网格对应真实像素，双层细线在深色、浅色和待填区域都能辨认。
    const displayWidth = canvas.getBoundingClientRect().width || canvas.width;
    const displayScale = canvas.width / displayWidth;
    ctx.beginPath();
    for (let col = 0; col <= image.width; col++) {
      ctx.moveTo(col * unit, 0); ctx.lineTo(col * unit, canvas.height);
    }
    for (let row = 0; row <= image.height; row++) {
      ctx.moveTo(0, row * unit); ctx.lineTo(canvas.width, row * unit);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = 1.4 * displayScale; ctx.stroke();
    ctx.strokeStyle = 'rgba(35,55,48,.32)'; ctx.lineWidth = .6 * displayScale; ctx.stroke();
    const { x, y } = position();
    if (!isResult && (step === 1 || step === 2 || step === 4)) {
      const left = Math.max(0, x - 1), top = Math.max(0, y - 1);
      ctx.strokeStyle = '#e8a14d'; ctx.lineWidth = 3;
      ctx.strokeRect(left * unit + 1.5, top * unit + 1.5,
        (Math.min(image.width - 1, x + 1) - left + 1) * unit - 3,
        (Math.min(image.height - 1, y + 1) - top + 1) * unit - 3);
      // 动画中的来源格与中间两张九宫格使用同一索引。
      if (kernelState.stage === 'multiply' && kernelState.count > 0) {
        const n = kernelState.count - 1;
        const sx = Math.max(0, Math.min(image.width - 1, x + n % 3 - 1));
        const sy = Math.max(0, Math.min(image.height - 1, y + Math.floor(n / 3) - 1));
        ctx.fillStyle = '#e8a14d88'; ctx.fillRect(sx * unit, sy * unit, unit, unit);
      }
    }
    // 双层选框在彩色、灰度及黑白图上都能看清。
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
    ctx.strokeRect(x * unit + 2, y * unit + 2, unit - 4, unit - 4);
    ctx.strokeStyle = '#b66430'; ctx.lineWidth = 2;
    ctx.strokeRect(x * unit + 2, y * unit + 2, unit - 4, unit - 4);
  }

  function matrix(target, values, colors = false) {
    target.replaceChildren(...values.map(value => {
      const span = document.createElement('span'); span.textContent = value;
      if (colors) { span.style.background = `rgb(${value},${value},${value})`; span.style.color = value < 120 ? '#fff' : '#26372e'; }
      return span;
    }));
  }

  function renderGray() {
    const { x, y } = position(), rgb = image.values[selected], value = gray.values[selected];
    ui('coordinate').textContent = `当前像素 · 第 ${x + 1} 列，第 ${y + 1} 行`;
    ['r', 'g', 'b'].forEach((channel, i) => { ui(channel).innerHTML = `<small>${channel.toUpperCase()}</small><b>${rgb[i]}</b>`; });
    const products = rgb.map((v, i) => v * [.299, .587, .114][i]);
    const calculated = phase > 0 || filled.has(selected);
    // 只切换可见性，不移除占位，避免求和结果出现时推走下方控件。
    ui('gray-products').style.visibility = calculated ? 'visible' : 'hidden';
    ui('gray-products').textContent = `${products.map(v => v.toFixed(3)).join(' + ')} = ${products.reduce((a,b) => a+b, 0).toFixed(3)}`;
    const ready = filled.has(selected);
    ui('gray-answer').textContent = ready ? String(value) : '？';
    ui('gray-swatch').style.background = ready ? `rgb(${value},${value},${value})` : 'transparent';
    ui('workbench').dataset.phase = ready ? 'filled' : phase === 1 ? 'calculate' : 'read';
    ui('progress').max = gray.values.length; ui('progress').value = filled.size;
    ui('progress-label').textContent = `已填 ${filled.size} / ${gray.values.length} 个像素${filled.size === gray.values.length ? ' · 转换完成' : ''}`;
    // 全部转换完成后再对照全图总量；填充进度由中间的进度条单独显示。
    const complete = filled.size === gray.values.length;
    // 统计8位通道的原始像素数据，不包含图片文件头、压缩或浏览器数组开销。
    ui('source-count').innerHTML = `<span>像素数据量 · RGB 每通道 8 位</span><span class="edge-data-equation">${image.width} × ${image.height} × 3 × 8</span><strong>= ${image.values.length * 3 * 8} 位</strong>`;
    ui('result-count').innerHTML = `<span>像素数据量 · 灰度每像素 8 位</span><span class="edge-data-equation">${image.width} × ${image.height} × 8</span><strong>= ${gray.values.length * 8} 位</strong>`;
    ui('source-count').style.visibility = ui('result-count').style.visibility = complete ? 'visible' : 'hidden';
    ui('result-title').textContent = filled.size === gray.values.length ? '灰度图 · 已填满' : '灰度图 · 逐格填充';
  }

  function render() {
    if (!restoring) storage.changed();
    const [heading, intro, takeaway] = STEPS[step];
    ui('heading').textContent = heading; ui('intro').textContent = intro; ui('takeaway').textContent = takeaway;
    root.dataset.edgeStep = step;
    root.dataset.grayComplete = String(filled.size === gray.values.length);
    for (const name of ['source-count', 'result-count']) {
      ui(name).style.visibility = 'visible';
    }
    root.querySelectorAll('[data-edge-step]').forEach(b => {
      const locked = !canEnter(Number(b.dataset.edgeStep));
      b.disabled = locked;
      b.classList.toggle('is-step-locked', locked);
      b.title = locked ? '首次提交前面的札记后解锁' : '';
      if (Number(b.dataset.edgeStep) === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    root.querySelectorAll('[data-edge-panel]').forEach(panel => {
      panel.hidden = panel.dataset.edgePanel !== (step === 0 ? 'gray' : step === 3 ? 'combine' : 'kernel');
    });
    for (const name of ['custom-controls', 'custom-editor', 'custom-apply']) ui(name).hidden = step !== 4;
    ui('kernel').hidden = step === 4;
    button('scan').hidden = button('kernel-replay').hidden = step === 4;
    button('kernel-play').disabled = step === 4 && customDirty;
    ui('kernel-middle-label').textContent = step === 4 ? '显示灰度' : '变化大小';
    ui('kernel-output-label').textContent = step === 4 ? '对应颜色' : '填入右图';
    button('previous').disabled = step === 0; button('next').disabled = step === 4;
    button('next').textContent = ['尝试横向卷积核 →', '尝试纵向卷积核 →', '尝试合并 →', '设计我的卷积核 →', '本次探索结束'][step];
    if (step < 4 && !canEnter(step + 1)) button('next').textContent = '填写本段札记 →';
    ui('step-count').textContent = `0${step + 1} / 05`;
    ui('source-title').textContent = step === 0 ? '彩色原图' : '灰度图';
    ui('source-size').textContent = ui('result-size').textContent = `${image.width} × ${image.height}`;
    ui('image-name').textContent = `${image.width} × ${image.height} 像素`;
    root.querySelectorAll('[data-edge-sample]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.edgeSample === sample)));
    if ([1,2,4].includes(step) && (kernelState.index !== selected || kernelState.axis !== currentAxis())) resetKernelState();
    draw(source, step === 0 ? image : gray, false);
    const { x, y } = position();
    if (step === 0) {
      renderGray(); draw(result, gray, true);
      ui('caption').textContent = '左右选框指向同一像素；未处理的位置以浅色棋盘格等待填充。';
      return;
    }
    const gx = convolveAt(gray, x, y, 'x'), gy = convolveAt(gray, x, y, 'y');
    ui('source-count').textContent = `${gray.values.length} 个灰度数值`;
    if (step < 3 || step === 4) {
      const axis = currentAxis(), cells = windowAt(gray, x, y);
      const kernel = step === 4 ? customConfig.values : KERNELS[axis].values;
      const response = step === 4 ? customKernelAt(gray, x, y, customConfig) : axis === 'x' ? gx : gy;
      if (kernelState.index !== selected || kernelState.axis !== axis) resetKernelState(axis);
      matrix(ui('window'), cells, true); matrix(ui('kernel'), kernel);
      ui('kernel-title').textContent = step === 4 ? customConfig.name : step === 1 ? '横向卷积核 · 左右比较' : '纵向卷积核 · 上下比较';
      ui('kernel-position').textContent = `中心 · 第 ${x + 1} 列，第 ${y + 1} 行`;
      renderKernel(cells, kernel, response);
      ui('result-title').textContent = step === 4 ? `${customConfig.name} · 整图效果` : step === 1 ? '左右变化 · 逐格填入' : '上下变化 · 逐格填入';
      ui('result-count').textContent = step === 4 ? '点击像素，观察这个位置怎样计算。' : `已填 ${kernelFilled[axis].size} / ${gray.values.length} 个像素 · 越亮，变化越强`;
      ui('caption').textContent = step === 4 ? '' : '九组数对应相乘，再把乘积汇总。先取变化大小，再除以 3 显示为亮度；未处理处留白。';
      if (step === 4) customOutput ||= filterCustomKernel(gray, customConfig);
      draw(result, step === 4 ? customOutput : strength(axis), true);
    } else {
      const output = contours(gray, 'both', threshold), kept = output.values.filter(v => v > 0).length;
      const combined = Math.hypot(gx, gy);
      // 小图使用完整的两方向结果；与大图共享同一个选中像素，数值保留正负。
      draw(directionX, strength('x'), false); draw(directionY, strength('y'), false);
      ui('direction-x-value').textContent = `当前值 ${gx}`;
      ui('direction-y-value').textContent = `当前值 ${gy}`;
      ui('combine-coordinate').textContent = `第 ${x + 1} 列 · 第 ${y + 1} 行`;
      ui('combine-values').innerHTML = `<span>√[<b class="edge-x-value">(${gx})²</b> + <b class="edge-y-value">(${gy})²</b>]</span><output>≈ ${combined.toFixed(1)}</output>`;
      ui('threshold-value').textContent = threshold;
      root.querySelector('[data-edge-control="threshold"]').value = threshold;
      ui('threshold-rule').textContent = `${combined.toFixed(1)} ${combined >= threshold ? '≥' : '<'} ${threshold} → ${combined >= threshold ? '留下，白色' : '略去，黑色'}`;
      ui('result-title').textContent = '合并后的轮廓'; ui('result-count').textContent = `留下 ${kept} / ${gray.values.length} 个白点`;
      ui('caption').textContent = '';
      draw(result, output, true);
    }
  }

  function resetKernelState(axis = currentAxis()) {
    const done = kernelFilled[axis].has(selected);
    kernelState = { index:selected, axis, count:done ? 9 : 0, stage:done ? 'land' : 'read' };
  }

  function renderKernel(cells, kernel, response) {
    root.dataset.kernelStage = kernelState.stage;
    const products = cells.map((value, i) => value * kernel[i]);
    const count = kernelState.count, active = kernelState.stage === 'multiply' ? count - 1 : -1;
    for (const name of ['window', step === 4 ? 'custom-editor' : 'kernel']) {
      [...ui(name).children].forEach((cell, i) => {
        cell.classList.toggle('is-active', i === active);
        cell.classList.toggle('is-processed', i < count);
      });
    }
    ui('kernel-products').replaceChildren(...products.map((value, i) => {
      const cell = document.createElement('span');
      cell.textContent = i < count ? String(value) : '·';
      cell.className = i >= count ? '' : value > 0 ? 'is-positive' : value < 0 ? 'is-negative' : 'is-zero';
      cell.classList.toggle('is-active', i === active); return cell;
    }));
    const partial = products.slice(0, count);
    ui('positive-sum').textContent = count ? `+${partial.filter(v => v > 0).reduce((a,b) => a+b, 0)}` : '—';
    ui('negative-sum').textContent = count ? String(partial.filter(v => v < 0).reduce((a,b) => a+b, 0)) : '—';
    const summed = ['sum', 'land'].includes(kernelState.stage);
    ui('kernel-sum').textContent = summed ? String(response) : '—';
    ui('kernel-magnitude').textContent = summed ? String(step === 4 ? customKernelValue(response, customConfig) : Math.abs(response)) : '—';
    const brightness = step === 4 ? customKernelValue(response, customConfig) : Math.round(Math.abs(response) / 3);
    ui('kernel-swatch').style.background = summed ? `rgb(${brightness},${brightness},${brightness})` : 'transparent';
    ui('kernel-calculation').textContent = step === 4 && customDirty ? '先应用修改，再观察逐格计算。'
      : kernelState.stage === 'read' ? '点击“逐格演示”，观察九组数怎样配对。'
      : kernelState.stage === 'multiply' ? `正在处理第 ${count} / 9 对 · ${kernel[active] === 0 ? '乘 0，这一格不计入' : kernel[active] === 1 ? '乘 1，保留这个数' : kernel[active] === -1 ? '乘 −1，变成相反数' : `乘以 ${kernel[active]}，得到对应乘积`}`
      : kernelState.stage === 'sum' ? (step === 4 ? '九个乘积相加，再按下方规则转换为灰度。' : '九个乘积汇总；正负相抵后，看看还剩多少。')
      : `${step === 4 ? '当前像素' : '结果已落到右图同一位置'} · 显示灰度 ${brightness}`;
    ui('kernel-progress').textContent = step === 4
      ? `显示：÷ ${customConfig.divisor}${customConfig.absolute ? ' → 取绝对值' : ''} → ${customConfig.offset < 0 ? '−' : '+'} ${Math.abs(customConfig.offset)} → 四舍五入并限制到 0—255`
      : `已填 ${kernelFilled[kernelState.axis].size} / ${gray.values.length} 格`;
  }

  // 每格先走完九对乘法，再汇总，最后才允许右图出现这个像素。
  function playKernel(auto = false) {
    if (auto) { startKernelAuto(); return; }
    pause();
    const axis = currentAxis(), done = kernelFilled[axis];
    if (axis !== 'custom') kernelPlans[axis] = null;
    if (kernelState.index !== selected || kernelState.axis !== axis || kernelState.stage === 'land') {
      kernelState = { index:selected, axis, count:0, stage:'read' };
    }
    running = 'kernel-play';
    button('kernel-play').textContent = '暂停演示';
    function tick() {
      if (kernelState.count < 9) {
        kernelState.count++; kernelState.stage = 'multiply'; render();
        timer = setTimeout(tick, 350); return;
      }
      kernelState.stage = 'sum'; render();
      timer = setTimeout(() => {
        done.add(selected); kernelState.stage = 'land'; render();
        pause();
      }, 700);
    }
    timer = setTimeout(tick, 250);
  }

  function startKernelAuto() {
    pause();
    const axis = step === 1 ? 'x' : 'y', done = kernelFilled[axis];
    if (done.size === gray.values.length) return;
    if (!kernelPlans[axis]) {
      const queue = [];
      for (let n = 0; n < gray.values.length; n++) {
        const index = (selected + n) % gray.values.length;
        if (!done.has(index)) queue.push(index);
      }
      // 空白开始固定60秒：首格慢演示，剩余55.9秒按像素数量分配。
      // 已手动完成的像素不重算，对应的快速演示时间也一并扣除。
      const perPixel = (KERNEL_AUTO_MS - KERNEL_FIRST_MS) / (gray.values.length - 1);
      kernelPlans[axis] = { queue, elapsed:0, duration:KERNEL_FIRST_MS + (queue.length - 1) * perPixel, cursor:0 };
    }
    const plan = kernelPlans[axis];
    plan.started = performance.now(); activeAutoAxis = axis; running = 'kernel-auto';
    button('scan').textContent = '暂停填充';
    function frame() {
      // 用实际经过的时间定位进度，避免定时器稍慢便累计成几分钟。
      const elapsed = Math.min(plan.duration, plan.elapsed + performance.now() - plan.started);
      if (elapsed < KERNEL_FIRST_MS) {
        selected = plan.queue[0];
        const count = elapsed < 250 ? 0 : Math.min(9, Math.floor((elapsed - 250) / 350) + 1);
        kernelState = { index:selected, axis, count, stage:elapsed < 250 ? 'read' : elapsed < 3400 ? 'multiply' : 'sum' };
      } else {
        const remaining = plan.queue.length - 1;
        const progress = remaining ? (elapsed - KERNEL_FIRST_MS) / (plan.duration - KERNEL_FIRST_MS) * remaining : 0;
        const completed = Math.min(remaining, Math.floor(progress));
        while (plan.cursor <= completed) done.add(plan.queue[plan.cursor++]);
        if (elapsed >= plan.duration) {
          selected = plan.queue.at(-1);
          kernelState = { index:selected, axis, count:9, stage:'land' };
        } else {
          selected = plan.queue[completed + 1];
          const landed = progress - completed >= .5 && completed + 1 < remaining;
          if (landed) done.add(selected);
          kernelState = { index:selected, axis, count:9, stage:landed ? 'land' : 'sum' };
        }
      }
      render();
      if (elapsed >= plan.duration) pause();
    }
    frame();
    if (running === 'kernel-auto') timer = setInterval(frame, 16);
  }

  function nextUnfilled() {
    for (let offset = 1; offset <= gray.values.length; offset++) {
      const i = (selected + offset) % gray.values.length;
      if (!filled.has(i)) return i;
    }
    return selected;
  }

  // 首格分成读取、求和、填色三拍；后续自动处理按真实结果依次填入。
  function processPixel(auto = false) {
    pause();
    if (filled.size === gray.values.length) { ui('status').textContent = '已经填满，点击“重播”可重新观察。'; return; }
    if (filled.has(selected)) selected = nextUnfilled();
    running = auto ? 'auto' : 'manual'; button('apply').disabled = true;
    if (auto) button('auto').textContent = '暂停填充';
    phase = 0; render();
    timer = setTimeout(() => {
      phase = 1; render();
      timer = setTimeout(() => {
        filled.add(selected); phase = 2; render();
        if (!auto) { pause(); return; }
        const batch = Math.ceil(gray.values.length / 600);
        timer = setInterval(() => {
          for (let n = 0; n < batch && filled.size < gray.values.length; n++) {
            selected = nextUnfilled(); filled.add(selected);
          }
          render(); if (filled.size === gray.values.length) pause();
        }, 16);
      }, 600);
    }, 450);
  }

  function setThreshold(value) {
    pause();
    threshold = value;
    render();
  }

  function writeCustomDraft() {
    coefficientInputs.forEach((input, i) => { input.value = customConfig.values[i]; });
    customField('divisor').value = customConfig.divisor;
    customField('offset').value = customConfig.offset;
    customField('absolute').checked = customConfig.absolute;
    ui('custom-draft').textContent = '已应用';
  }

  function loadCustomPreset() {
    pause();
    const preset = CUSTOM_KERNELS[customField('preset').value];
    customConfig = { ...preset, values:[...preset.values] };
    customDirty = false;
    customOutput = null; kernelFilled.custom.clear(); kernelState.index = -1;
    writeCustomDraft(); render();
  }

  function applyCustom() {
    pause();
    const values = coefficientInputs.map(input => Number(input.value));
    const divisor = Number(customField('divisor').value), offset = Number(customField('offset').value);
    if (coefficientInputs.some(input => input.value.trim() === '') || values.some(v => !Number.isInteger(v) || v < -9 || v > 9)) {
      ui('custom-draft').textContent = '九格请填 −9 到 9 的整数'; return;
    }
    if (!Number.isFinite(divisor) || divisor < .1 || divisor > 1000 || customField('offset').value.trim() === '' || !Number.isInteger(offset) || Math.abs(offset) > 255) {
      ui('custom-draft').textContent = '除数填 0.1—1000，偏移填 −255—255 的整数'; return;
    }
    customConfig = { name:'我的卷积核', values, divisor, offset, absolute:customField('absolute').checked };
    customDirty = false;
    customOutput = null; kernelFilled.custom.clear(); kernelState.index = -1;
    ui('custom-draft').textContent = '已应用'; render();
  }

  function setImage(next) {
    pause(); image = next; gray = grayscale(image); selected = 0; filled = new Set(); phase = 0;
    kernelFilled.x.clear(); kernelFilled.y.clear(); kernelFilled.custom.clear(); kernelPlans.x = kernelPlans.y = null;
    kernelState.index = -1; strengthImages = {}; customOutput = null;
    ui('status').textContent = ''; render();
  }

  async function loadBeast(key, version, saved = null) {
    const bitmap = new Image();
    bitmap.src = new URL(`../../bestiary/${key === 'fish' ? 'heluo-fish' : 'bifang'}.png`, import.meta.url).href;
    try {
      await bitmap.decode(); if (version !== loadVersion) return;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 48, 48);
      const scale = Math.min(48 / bitmap.naturalWidth, 48 / bitmap.naturalHeight);
      const w = bitmap.naturalWidth * scale, h = bitmap.naturalHeight * scale;
      ctx.drawImage(bitmap, (48 - w) / 2, (48 - h) / 2, w, h);
      const data = ctx.getImageData(0, 0, 48, 48).data, values = [];
      for (let i = 0; i < data.length; i += 4) values.push([data[i], data[i+1], data[i+2]]);
      setImage({ width:48, height:48, values });
      if (saved) restoreSaved(saved);
    } catch { if (version === loadVersion) {
      restoring = false;
      if (saved) { sample = 'horizontal'; setImage(coloredSample(sample)); }
      ui('status').textContent = '图片未能读取，请重新选择。';
    } }
  }

  function showStep(next) {
    if (!canEnter(next)) return;
    pause(); step = next; ui('status').textContent = ''; render();
    onStepChange(step);
  }
  root.querySelectorAll('[data-edge-step]').forEach(b => b.addEventListener('click', () => {
    if (!b.disabled) showStep(Number(b.dataset.edgeStep));
  }));
  root.querySelectorAll('[data-edge-sample]').forEach(b => b.addEventListener('click', () => {
    pause(); restoring = false; sample = b.dataset.edgeSample; const version = ++loadVersion;
    if (sample === 'fish' || sample === 'bifang') loadBeast(sample, version);
    else setImage(coloredSample(sample));
  }));
  root.querySelector('[data-edge-control="threshold"]').addEventListener('input', e => setThreshold(Number(e.target.value)));
  customField('preset').addEventListener('change', loadCustomPreset);
  for (const input of [...coefficientInputs, customField('divisor'), customField('offset'), customField('absolute')]) {
    input.addEventListener('input', () => {
      pause(); customDirty = true; kernelFilled.custom.clear();
      kernelState = { index:selected, axis:'custom', count:0, stage:'read' };
      ui('custom-draft').textContent = '已修改，待应用'; render();
    });
  }
  for (const canvas of [source, result, directionX, directionY]) {
    canvas.addEventListener('click', e => {
      pause(); const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(image.width - 1, Math.floor((e.clientX - rect.left) / rect.width * image.width)));
      const y = Math.max(0, Math.min(image.height - 1, Math.floor((e.clientY - rect.top) / rect.height * image.height)));
      selected = y * image.width + x; phase = 0; render();
    });
    canvas.addEventListener('keydown', e => {
      const delta = { ArrowLeft:-1, ArrowRight:1, ArrowUp:-image.width, ArrowDown:image.width }[e.key];
      if (!delta) return;
      e.preventDefault(); pause(); selected = Math.max(0, Math.min(gray.values.length - 1, selected + delta)); phase = 0; render();
    });
  }
  root.addEventListener('click', e => {
    const action = e.target.closest('[data-edge-action]')?.dataset.edgeAction;
    if (action === 'apply') processPixel();
    if (action === 'auto') { if (running) pause(); else processPixel(true); }
    if (action === 'replay') { pause(); filled.clear(); selected = 0; phase = 0; ui('status').textContent = ''; render(); }
    if (action === 'previous' || action === 'next') {
      const next = Math.max(0, Math.min(4, step + (action === 'next' ? 1 : -1)));
      if (!canEnter(next)) root.dispatchEvent(new CustomEvent('worksheet:open', { bubbles: true, detail: { step } }));
      else showStep(next);
    }
    if (action === 'move') { pause(); selected = (selected + 1) % gray.values.length; render(); }
    if (action === 'kernel-play') { if (running) pause(); else playKernel(); }
    if (action === 'kernel-replay') { pause(); const axis = step === 1 ? 'x' : 'y'; kernelFilled[axis].clear(); kernelPlans[axis] = null; selected = 0; kernelState.index = -1; render(); }
    if (action === 'scan') {
      if (running) pause(); else playKernel(true);
    }
    if (action === 'custom-apply') applyCustom();
    if (action === 'custom-reset') loadCustomPreset();
  });
  writeCustomDraft();
  function restoreSaved(saved) {
    try {
      selected = Math.max(0, Math.min(gray.values.length - 1, saved.selected || 0));
      threshold = Number.isFinite(saved.threshold) ? saved.threshold : 100;
      const validIndices = items => new Set((Array.isArray(items) ? items : []).filter(i => Number.isInteger(i) && i >= 0 && i < gray.values.length));
      filled = validIndices(saved.filled); phase = saved.phase || 0;
      for (const axis of ['x', 'y', 'custom']) kernelFilled[axis] = validIndices(saved.kernelFilled?.[axis]);
      if (saved.kernelState) kernelState = saved.kernelState;
      if (Array.isArray(saved.customConfig?.values) && saved.customConfig.values.length === 9) customConfig = saved.customConfig;
      writeCustomDraft();
      const draft = saved.customDraft;
      if (draft && Array.isArray(draft.values) && draft.values.length === 9) {
        coefficientInputs.forEach((input, i) => { input.value = draft.values[i]; });
        customField('preset').value = draft.preset;
        customField('divisor').value = draft.divisor; customField('offset').value = draft.offset;
        customField('absolute').checked = draft.absolute === true;
      }
      customDirty = saved.customDirty === true;
      if (customDirty) ui('custom-draft').textContent = '已修改，待应用';
    } catch { /* 无效本地记录保留默认参数。 */ }
    restoring = false; render();
  }
  const saved = storage.read();
  if (saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < 5
      && ['horizontal', 'vertical', 'diagonal', 'house', 'fish', 'bifang'].includes(saved.sample)) {
    restoring = true; step = saved.step; sample = saved.sample;
    if (sample === 'fish' || sample === 'bifang') void loadBeast(sample, ++loadVersion, saved);
    else { image = coloredSample(sample); gray = grayscale(image); restoreSaved(saved); }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); if (!restoring) storage.flush(); } });
  return {
    refresh:render, pause() { pause(); if (!restoring) storage.flush(); }, goToStep:showStep,
    getStep: () => step,
    reset() {
      pause();
      // 使尚在读取的异兽图片失效，避免重置后被旧请求覆盖。
      ++loadVersion;
      restoring = false;
      step = 0; threshold = 100; sample = 'horizontal';
      kernelState = { index:-1, axis:'x', count:0, stage:'read' };
      customConfig = { ...CUSTOM_KERNELS.blur, values:[...CUSTOM_KERNELS.blur.values] };
      customDirty = false;
      customField('preset').value = 'blur';
      writeCustomDraft();
      setImage(coloredSample(sample));
      onStepChange(0);
      storage.clear();
    },
    setGate(steps) {
      allowedSteps = steps ? new Set(steps) : null;
      if (!canEnter(step)) showStep(steps[0]);
      else render();
    },
  };
}
