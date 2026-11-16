import { createMountain, binary8, sourceForEnlarged, enlargeNearest, meanBlock, shrinkMean, compareImages } from './model.mjs';
import { createPixelGrid } from './pixel-grid.js';
import { createPixelDataGrid } from './data-grid.js';
import { setupMathCalculator } from './calculator.mjs';
import { createExperimentStorage } from '../experiment-storage.js';

const REQUIRED_MANUAL_PIXELS = 2;
const CHANNELS = ['R', 'G', 'B'];

const STEPS = [
  { heading: '先读懂山中的一个像素', intro: '点击山中的任意像素，观察 RGB 三个通道的十进制和二进制。', takeaway: '一个 RGB 像素由三个通道数值共同表示。每个通道都可以写成十进制或二进制。' },
  { heading: '把 1 个像素，复制成 2×2 个', intro: '点左图选中一个像素，再点“处理当前”，看它变成右图的四个同色像素。继续点击可逐格处理；“自动填充”完成剩余部分，“重播”仅清空本步的放大结果，方便再观察。', takeaway: '最近邻放大：每个原像素的 RGB 数值复制到 2×2 的四个位置。宽、高各变成 2 倍，像素总数变成 4 倍。' },
  { heading: '用 9 个像素，算出 1 个像素', intro: '', takeaway: '' },
  { heading: '像素数量回来了，细节也回来了吗？', intro: '将缩小后的图像按宽高各 3 倍复制放大，恢复到原来的像素尺寸，再与原图比较。', takeaway: '简单放大只能复制已有数值，无法找回求平均时已经丢失的细节。' },
];

function freshState() {
  return {
    step: 0, numbers: false, dataView: false,
    warmup: { x: 7, y: 5 }, enlarged: { x: 14, y: 10 }, small: { x: 2, y: 1 }, restored: { x: 7, y: 4 },
    applied: { 1: false, 2: false },
    manualPixels: new Map(), channelWork: new Map(), shrinkChannel: 0, shrinkAutoCompleted: false,
    feedback: { 2: '' }, errors: { 2: false },
    restoreShown: false, prediction: '', differences: false,
    processed: { 1: new Set(), 2: new Set() }, running: false,
  };
}

function blockIndices(image, x, y, size) {
  const indices = [];
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) indices.push((y + dy) * image.width + x + dx);
  }
  return indices;
}

export function mountImageMath(root, onStepChange = () => {}) {
  const locksEnabled = document.querySelector('meta[name="progress-locks-enabled"]')?.content !== 'false';
  const mountain = createMountain();
  let state = freshState();
  const storage = createExperimentStorage(root, 'lesson-6-task-1', () => ({ ...state, running: false,
    manualPixels: [...state.manualPixels], channelWork: [...state.channelWork],
    processed: { 1: [...state.processed[1]], 2: [...state.processed[2]] } }));
  try {
    const saved = storage.read();
    if (saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step < 4
        && ['warmup','enlarged','small','restored'].every(key => Number.isInteger(saved[key]?.x) && Number.isInteger(saved[key]?.y)
          && saved[key].x >= 0 && saved[key].y >= 0
          && saved[key].x < mountain.width * (key === 'enlarged' ? 2 : key === 'small' ? 1/3 : 1)
          && saved[key].y < mountain.height * (key === 'enlarged' ? 2 : key === 'small' ? 1/3 : 1))) {
      const restored = { ...freshState(), ...saved, running: false,
        manualPixels: new Map(saved.manualPixels), channelWork: new Map(saved.channelWork),
        processed: { 1: new Set(saved.processed[1]), 2: new Set(saved.processed[2]) } };
      state = restored;
    }
  } catch { /* 旧结构或坏记录不阻断实验。 */ }
  let pendingResize = false;
  let timer;
  let dataGrid;
  let allowedSteps = null;
  const canEnter = step => !allowedSteps || allowedSteps.has(step);
  const parts = Object.fromEntries([...root.querySelectorAll('[data-part]')].map(element => [element.dataset.part, element]));
  const answer = root.querySelector('#math-answer');
  const channelTabs = [...root.querySelectorAll('[data-shrink-channel]')];
  const action = name => root.querySelector(`[data-action="${name}"]`);
  const calculator = setupMathCalculator(root);
  const boards = [...root.querySelectorAll('[data-board]')].map((element, index) => ({
    element, mount: element.querySelector('.math-canvas-mount'),
    canvas: element.querySelector('canvas'),
    grid: createPixelGrid(element.querySelector('canvas'), (x, y) => selectPixel(index, x, y)),
  }));

  function images() {
    const original = mountain;
    const small = shrinkMean(original, 3);
    return { original, enlarged: enlargeNearest(original, 2), small, restored: enlargeNearest(small, 3) };
  }

  function currentSmallIndex() {
    return state.small.y * (mountain.width / 3) + state.small.x;
  }

  function channelWork(index = currentSmallIndex()) {
    if (!state.channelWork.has(index)) {
      state.channelWork.set(index, { values: ['', '', ''], completed: [false, false, false] });
    }
    return state.channelWork.get(index);
  }

  function saveDraft() {
    // 按“目标像素 + 颜色通道”保存草稿，换标签、换像素或关闭后都能接着算。
    if (state.step === 2 && !answer.disabled) channelWork().values[state.shrinkChannel] = answer.value;
    storage.changed();
  }

  function selectPixel(board, x, y) {
    saveDraft();
    pause();
    if (state.step === 0) state.warmup = { x, y };
    else if (state.step === 1) state.enlarged = board === 0 ? { x: x * 2, y: y * 2 } : { x: Math.floor(x / 2) * 2, y: Math.floor(y / 2) * 2 };
    else if (state.step === 2) state.small = board === 0 ? { x: Math.floor(x / 3), y: Math.floor(y / 3) } : { x, y };
    else state.restored = board === 1 ? { x: x * 3 + 1, y: y * 3 + 1 } : { x, y };
    if (state.step === 2) {
      state.shrinkChannel = 0;
      answer.removeAttribute('aria-invalid');
      state.feedback[state.step] = '';
      state.errors[state.step] = false;
    }
    render();
  }

  function showStep(step) {
    if (!canEnter(step)) return;
    saveDraft();
    pause();
    calculator.close();
    state.step = step;
    answer.removeAttribute('aria-invalid');
    render();
    onStepChange(state.step);
  }

  function renderReadout(original) {
    const { x, y } = state.warmup;
    const pixel = original.values[y * original.width + x];
    parts.coordinate.textContent = `第 ${y + 1} 行 · 第 ${x + 1} 列`;
    parts['rgb-code'].textContent = `RGB (${pixel.join(', ')})`;
    // 三个通道同时显示，保留前导零，不再让学生切换观察。
    ['red', 'green', 'blue'].forEach((name, index) => {
      parts[`${name}-value`].textContent = pixel[index];
      parts[`${name}-binary`].textContent = binary8(pixel[index]);
    });
    parts.swatch.style.backgroundColor = `rgb(${pixel.join(',')})`;
    action('numbers').checked = state.numbers;
  }

  function calculationDetail(original) {
    return meanBlock(original, state.small.x, state.small.y, 3);
  }

  function renderCalculation(original) {
    const detail = calculationDetail(original);
    const index = state.small.y * (original.width / 3) + state.small.x;
    const filled = state.processed[2].has(index), applied = state.applied[2];
    const unlocked = !locksEnabled || state.manualPixels.size >= REQUIRED_MANUAL_PIXELS;
    const work = channelWork(index), channel = state.shrinkChannel;
    const completed = filled || work.completed[channel];
    channelTabs.forEach((tab, index) => {
      const done = filled || work.completed[index];
      const selected = index === channel;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('aria-label', `${CHANNELS[index]} 通道，${done ? '已完成' : '未完成'}`);
      tab.tabIndex = selected ? 0 : -1;
      tab.disabled = state.running;
      const ring = tab.querySelector('img');
      ring.src = done ? ring.dataset.completeSrc : ring.dataset.incompleteSrc;
    });
    root.querySelector('#math-channel-panel').setAttribute('aria-labelledby', `math-channel-tab-${channel}`);
    parts.sample.replaceChildren(...detail.cells.map(cell => {
      const item = document.createElement('span');
      // 一次只展示当前通道的九个数；背景仍对应原图颜色，方便定位来源。
      item.textContent = cell.value[channel];
      item.style.backgroundColor = `rgb(${cell.value.join(',')})`;
      item.style.color = cell.value.reduce((a,b) => a + b, 0) < 420 ? '#fff' : '#292d28';
      return item;
    }));
    parts['source-label'].textContent = `${state.small.y * 3 + 1}—${state.small.y * 3 + 3} 行 · ${state.small.x * 3 + 1}—${state.small.x * 3 + 3} 列`;
    parts.formula.textContent = completed
      ? `${CHANNELS[channel]} 均值 ${detail.mean[channel].toFixed(2)} → ${detail.rounded[channel]}`
      : '求平均，四舍五入。';
    parts.question.textContent = `第 ${state.small.y + 1} 行 · 第 ${state.small.x + 1} 列 · ${CHANNELS[channel]} 值`;
    parts.exercise.hidden = false;
    answer.value = filled ? detail.rounded[channel] : work.values[channel];
    answer.disabled = completed || state.running;
    if (completed) answer.removeAttribute('aria-invalid');
    answer.setAttribute('aria-label', `${CHANNELS[channel]} 通道均值`);
    action('check').disabled = filled || state.running || (completed && !work.completed.every(Boolean));
    action('check').textContent = filled ? '已填入' : work.completed.every(Boolean) ? '填入像素' : completed ? '已完成' : `验证 ${CHANNELS[channel]}`;
    parts.feedback.textContent = state.running ? '自动处理中…' : state.feedback[2];
    parts.feedback.classList.toggle('error', state.errors[2] && !state.running);
    parts['manual-count'].textContent = `已手算 ${state.manualPixels.size} / ${REQUIRED_MANUAL_PIXELS} 格`;
    parts['manual-count'].classList.toggle('is-unlocked', unlocked);
    action('auto').disabled = !unlocked || applied;
    action('auto').textContent = state.running ? '暂停演示' : '自动继续';
    action('auto').title = unlocked ? '' : `手算 ${REQUIRED_MANUAL_PIXELS} 个不同像素后开放`;
    action('replay').disabled = (locksEnabled && !state.shrinkAutoCompleted) || state.running;
    action('replay').title = !locksEnabled || state.shrinkAutoCompleted ? '清空缩小图重新演示，保留已完成的手算记录' : '第一次自动处理完成后开放';
    const target = images().small;
    parts['process-progress'].textContent = `已填入 ${state.processed[2].size} / ${target.values.length} 个输出像素`;
  }

  function renderEnlarge(data) {
    const source = sourceForEnlarged(state.enlarged.x, state.enlarged.y, 2);
    const pixel = data.original.values[source.y * data.original.width + source.x];
    parts['enlarge-coordinate'].textContent = `原图第 ${source.y + 1} 行 · 第 ${source.x + 1} 列`;
    parts['copy-color'].textContent = `RGB (${pixel.join(', ')}) → 四格相同`;
    parts['copy-diagram'].style.setProperty('--copy-color', `rgb(${pixel.join(',')})`);
    parts['copy-diagram'].dataset.copied = state.processed[1].has(state.enlarged.y * data.enlarged.width + state.enlarged.x);
    const copied = state.processed[1].size / 4;
    parts['enlarge-progress'].max = data.original.values.length;
    parts['enlarge-progress'].value = copied;
    parts['enlarge-count'].textContent = `已复制 ${copied} / ${data.original.values.length} 格 · 生成 ${state.processed[1].size} 个像素`;
    action('enlarge-apply').disabled = state.running || state.applied[1];
    action('enlarge-auto').disabled = state.applied[1];
    action('enlarge-auto').textContent = state.running ? '暂停填充' : '自动填充';
  }

  function renderComparison(data) {
    const allowed = !locksEnabled || state.applied[2];
    action('restore').textContent = !allowed ? '先去完成缩小' : state.restoreShown ? '再次对照结果' : '放大并对照';
    root.querySelector('.math-predictions').hidden = !allowed;
    action('differences').disabled = !state.restoreShown;
    action('differences').checked = state.differences;
    if (!state.restoreShown) {
      parts['comparison-feedback'].textContent = allowed ? '先选择一个预测，再验证你的想法。' : '先把均值规则应用到缩小图像，再回来观察。';
      parts['comparison-count'].textContent = '';
      parts['comparison-pixel'].textContent = '';
      return;
    }
    parts['comparison-feedback'].classList.remove('error');
    parts['comparison-feedback'].textContent = state.prediction === 'no'
      ? '你的预测与结果一致。注意比较山脊、明暗交界和积雪的细节。'
      : '对照山脊的细节：像素数量恢复了，但原来的数值没有全部回来。';
    const comparison = compareImages(data.original, data.restored);
    parts['comparison-count'].textContent = `${comparison.total} 个像素中，有 ${comparison.changed.length} 个像素的颜色发生变化。`;
    const { x, y } = state.restored;
    const before = data.original.values[y * data.original.width + x];
    const after = data.restored.values[y * data.restored.width + x];
    parts['comparison-pixel'].textContent = `第 ${y + 1} 行、第 ${x + 1} 列的 RGB：原图 (${before.join(', ')}) → 区块平均值 (${after.join(', ')}) → 再次放大仍为 (${after.join(', ')})。`;
  }

  function boardSetup(data) {
    const originalTitle = '原图';
    const count = image => `${image.width}×${image.height} px`;
    if (state.step === 0) return [{
      image: data.original, title: state.dataView ? '山水的 RGB 数据' : '落日山水',
      note: state.dataView
        ? `${data.original.width} 列 × ${data.original.height} 行 × 3 通道 = ${data.original.values.length * 3} 个数。每格从上到下是 R、G、B；原色保留在格子上沿，可滚动查看。`
        : `${data.original.width}×${data.original.height} 个彩色像素，每个像素包含 R、G、B 三个数。`,
      selected: state.warmup, highlights: [], numbers: state.numbers,
    }];
    if (state.step === 1) {
      const source = sourceForEnlarged(state.enlarged.x, state.enlarged.y, 2);
      const copied = blockIndices(data.enlarged, source.x * 2, source.y * 2, 2);
      return [
        { image: data.original, title: originalTitle, note: `${data.original.width}×${data.original.height} = ${data.original.values.length} 个像素`, selected: source },
        { image: data.enlarged, title: '宽高各放大 2 倍', note: `最近邻 · ${data.enlarged.values.length} 个像素，原来的 4 倍`, selected: state.enlarged, highlights: copied, revealed: state.applied[1] ? null : [...state.processed[1]] },
      ];
    }
    if (state.step === 2) {
      const selected = state.small;
      const block = blockIndices(data.original, selected.x * 3, selected.y * 3, 3);
      return [
        { image: data.original, title: originalTitle, note: '', highlights: block, selected: { x: selected.x * 3 + 1, y: selected.y * 3 + 1 } },
        { image: data.small, title: '选择像素 · 缩小至 1/3', note: '', selected, revealed: state.applied[2] ? null : [...state.processed[2]] },
      ];
    }
    const source = sourceForEnlarged(state.restored.x, state.restored.y, 3);
    return [
      { image: data.original, title: originalTitle, note: '观察山脊与明暗交界。', selected: state.restored },
      { image: data.small, title: '缩小后', note: '每个数来自 9 个像素的平均值。', selected: source, revealed: state.applied[2] ? null : [] },
      { image: data.restored, title: '再次放大', note: state.restoreShown ? '尺寸相同，细节却不同。' : '先作预测，再放大对照。', selected: state.restored, highlights: blockIndices(data.restored, source.x * 3, source.y * 3, 3), revealed: state.restoreShown ? null : [], changed: state.restoreShown && state.differences ? compareImages(data.original, data.restored).changed : [] },
    ].map(item => ({ ...item, size: count(item.image) }));
  }

  function drawBoards(data = images()) {
    if (root.hidden || !root.clientWidth || (state.step === 0 && state.dataView)) return;
    const setup = boardSetup(data);
    // 所有对照图使用相同的单像素显示大小，让缩放尺寸的差异真实可见。
    const cell = Math.min(state.step === 0 ? (state.numbers ? 28 : 22) : state.step === 2 ? 34 : 20,
      ...setup.map((item, index) => Math.max(1, boards[index].mount.clientWidth) / item.image.width));
    setup.forEach((item, index) => {
      boards[index].grid.draw({ ...item, width: Math.max(1, cell * item.image.width) });
    });
  }

  function pause() {
    clearTimeout(timer); clearInterval(timer); timer = null;
    state.running = false;
    root.classList.remove('is-processing');
  }

  function markUnit(data, step, index) {
    if (step === 1) {
      const x = index % data.original.width, y = Math.floor(index / data.original.width);
      blockIndices(data.enlarged,x*2,y*2,2).forEach(i=>state.processed[step].add(i));
      state.enlarged = {x:x*2,y:y*2};
    } else {
      const target = data.small;
      state.processed[step].add(index);
      const selected = {x:index%target.width,y:Math.floor(index/target.width)};
      state.small=selected;
    }
    const target = step === 1 ? data.enlarged : data.small;
    state.applied[step] = state.processed[step].size === target.values.length;
  }

  function pendingUnits(data, step, start = 0) {
    // 从当前位置继续，跳过已经完成的区块；暂停后不会重新扫描已填好的部分。
    const total = (step === 1 ? data.original : data.small).values.length;
    return Array.from({ length: total }, (_, offset) => (start + offset) % total).filter(index => {
      const output = step === 1
        ? Math.floor(index / data.original.width) * 2 * data.enlarged.width + (index % data.original.width) * 2
        : index;
      return !state.processed[step].has(output);
    });
  }

  function processCurrent() {
    const step=state.step;
    if (step !== 1 || state.running || state.applied[step]) return;
    pause();
    const data = images();
    const source = sourceForEnlarged(state.enlarged.x, state.enlarged.y, 2);
    const index = pendingUnits(data, step, source.y * data.original.width + source.x)[0];
    state.enlarged = { x: (index % data.original.width) * 2, y: Math.floor(index / data.original.width) * 2 };
    state.running=true; render();
    // 放大先突出来源，再显示四个复制结果，停留片刻后才移到下一格。
    // 延时仅服务教学观察，不代表算法的实际耗时。
    timer=setTimeout(()=>{
      markUnit(data,step,index);
      render();
      timer = setTimeout(() => {
        const next = pendingUnits(data, 1, index + 1)[0];
        if (next !== undefined) state.enlarged = { x: (next % data.original.width) * 2, y: Math.floor(next / data.original.width) * 2 };
        pause(); render();
      }, 450);
    }, 500);
  }

  function autoContinue() {
    if (state.running) {pause();render();return;}
    const step=state.step;
    if ((step !== 1 && step !== 2) || state.applied[step] || (locksEnabled && step === 2 && state.manualPixels.size < REQUIRED_MANUAL_PIXELS)) return;
    saveDraft();
    calculator.close();
    const data=images();
    const source = step === 1 ? sourceForEnlarged(state.enlarged.x, state.enlarged.y, 2) : state.small;
    const start = source.y * (step === 1 ? data.original : data.small).width + source.x;
    const units = pendingUnits(data, step, start);
    let cursor=0;
    const started=performance.now();
    state.running=true;
    timer=setInterval(()=>{
      const until=Math.min(units.length,Math.max(1,Math.floor((performance.now()-started)/10000*units.length)));
      while(cursor<until) markUnit(data,step,units[cursor++]);
      if(cursor===units.length) {
        if (step === 2) {
          state.shrinkAutoCompleted = true;
          state.feedback[2] = '';
          state.errors[2] = false;
        }
        pause();
      }
      render();
    },100);
    render();
  }

  function render() {
    storage.changed();
    const data = images(), step = state.step;
    root.dataset.experimentStep = step;
    root.classList.toggle('is-processing',state.running);
    parts['process-controls'].hidden = step !== 2;
    parts['enlarge-console'].hidden = step !== 1;
    const dataVisible = step === 0 && state.dataView;
    action('toggle-data').hidden = step !== 0;
    action('toggle-data').setAttribute('aria-pressed', String(dataVisible));
    action('toggle-data').setAttribute('aria-label', dataVisible ? '还原为图：显示原来的彩色图像' : '化图为数：显示原图的 RGB 数据');
    action('toggle-data').firstChild.textContent = dataVisible ? '还原为图 ' : '化图为数 ';
    boards[0].mount.hidden = dataVisible;
    parts['data-view'].hidden = !dataVisible;
    parts['number-option'].hidden = dataVisible;
    if (dataVisible) dataGrid.select(state.warmup);
    root.querySelectorAll('[data-step]').forEach(button => {
      const locked = !canEnter(Number(button.dataset.step));
      button.disabled = locked;
      button.classList.toggle('is-step-locked', locked);
      button.title = locked ? '首次提交前面的札记后解锁' : '';
      if (Number(button.dataset.step) === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    parts.heading.textContent = STEPS[step].heading;
    parts.intro.textContent = STEPS[step].intro;
    parts.takeaway.textContent = STEPS[step].takeaway;
    parts.intro.hidden = step === 2;
    root.querySelector('.math-takeaway').hidden = step === 2;
    if (step === 0) {
      parts.intro.textContent = dataVisible ? '山水展开成了数字。点击任意数据格，观察它与右侧颜色、二进制的对应关系。' : '点击云、山、落日或水面，分别观察 R、G、B 的十进制与 8 位二进制。';
      parts.takeaway.textContent = dataVisible ? '图像与这张数据表是同一份 RGB 数据的两种显示方式；切换显示，像素的数值不变。' : '一个彩色像素有三个通道。三组数一起决定颜色，每组数可写成十进制或二进制。';
    }
    parts.readout.hidden = step !== 0;
    parts.calculation.hidden = step !== 2;
    parts.comparison.hidden = step !== 3;
    root.querySelector('.math-inspector').hidden = step === 1;
    // 缩小图移到右侧计算台；其余步骤放回原有对照区，复用同一块画布。
    const boardsHome = root.querySelector('.math-boards');
    const secondHome = step === 2 ? parts['shrink-target'] : boardsHome;
    if (boards[1].element.parentElement !== secondHome) {
      if (step === 2) secondHome.append(boards[1].element);
      else boardsHome.insertBefore(boards[1].element, boards[2].element);
    }
    const setup = boardSetup(data);
    root.querySelector('.math-boards').dataset.count = setup.length;
    root.querySelector('.math-boards').style.gridTemplateColumns = step===1 ? 'minmax(0,1fr) minmax(0,2fr)' : '';
    boards.forEach((board, index) => {
      const item = setup[index];
      board.element.hidden = !item;
      if (!item) return;
      board.element.querySelector('[data-board-title]').textContent = item.title;
      board.element.querySelector('[data-board-size]').textContent = `${item.image.width}×${item.image.height} px`;
      board.element.querySelector('[data-board-note]').textContent = item.note;
      board.canvas.setAttribute('aria-label', `${item.title}，${item.image.width} 列 ${item.image.height} 行，可点击或使用方向键选择像素`);
    });
    if (step === 0) renderReadout(data.original);
    else if (step === 1) renderEnlarge(data);
    else if (step === 2) renderCalculation(data.original);
    else renderComparison(data);
    action('previous').disabled = step === 0;
    action('next').disabled = (step === 1 || step === 2) && !state.applied[step];
    action('next').textContent = ['去放大图像 →', '去缩小图像 →', '去再次放大 →', '填写本段札记 →'][step];
    parts['navigation-note'].textContent = step === 2 ? '' : step === 0 ? '先点几个不同深浅的像素' : step === 3 ? '比较像素数与真实细节' : state.applied[step] ? '已完成，可继续探索' : '逐格复制，或自动填充';
    if (step < 3 && !canEnter(step + 1)) {
      action('next').textContent = '填写本段札记 →';
      parts['navigation-note'].textContent = '首次提交本段札记，解锁下一步';
    }
    drawBoards(data);
  }

  function checkAnswer() {
    const step = state.step;
    if (step !== 2 || state.running) return;
    const data = images();
    const index = state.small.y * data.small.width + state.small.x;
    if (state.processed[2].has(index)) return;
    const work = channelWork(index), channel = state.shrinkChannel;
    if (work.completed[channel] && !work.completed.every(Boolean)) return;
    saveDraft();
    const raw = answer.value.trim(), value = Number(raw);
    const expected = calculationDetail(data.original).rounded[channel];
    if (!raw || !Number.isInteger(value) || value < 0 || value > 255) {
      state.feedback[step] = '请输入 0—255 的整数。';
      state.errors[step] = true;
    } else if (value !== expected) {
      state.feedback[step] = `再检查 ${CHANNELS[channel]} 的均值。`;
      state.errors[step] = true;
    } else {
      state.errors[step] = false;
      work.values[channel] = String(value);
      work.completed[channel] = true;
      // 逐通道验证、整像素计数；仅在三个红圈全部变绿后填色。
      if (work.completed.every(Boolean)) {
        state.manualPixels.set(index, work.values.map(Number));
        markUnit(data, 2, index);
      }
      state.feedback[step] = '';
      state.restoreShown = false;
      state.differences = false;
    }
    answer.setAttribute('aria-invalid', String(state.errors[step]));
    render();
    if (state.processed[2].has(index) && !state.applied[2]) boards[1].canvas.focus({ preventScroll: true });
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-shrink-channel')) {
      saveDraft();
      state.shrinkChannel = Number(button.dataset.shrinkChannel);
      state.feedback[2] = ''; state.errors[2] = false;
      answer.removeAttribute('aria-invalid');
      render();
      return;
    }
    if (button.hasAttribute('data-step')) { showStep(Number(button.dataset.step)); return; }
    const name = button.dataset.action;
    if (name === 'previous') showStep(Math.max(0, state.step - 1));
    else if (name === 'next') {
      // 末步只打开札记；整项实验的重置统一由右上角入口负责。
      if (state.step === 3 || !canEnter(state.step + 1)) {
        root.dispatchEvent(new CustomEvent('worksheet:open', { bubbles: true, detail: { step: state.step } }));
        return;
      }
      showStep(state.step + 1);
    } else if (name === 'toggle-data') {
      state.dataView = !state.dataView;
      if (state.dataView) {
        dataGrid ||= createPixelDataGrid(parts['data-view'], mountain, (x, y) => selectPixel(0, x, y));
        parts['data-view'].style.setProperty('--data-height', boards[0].canvas.style.height || '330px');
      }
      render();
      if (state.dataView) requestAnimationFrame(() => { if (state.step === 0 && state.dataView) dataGrid.revealSelected(); });
    } else if (name === 'check') checkAnswer();
    else if (name === 'enlarge-apply') processCurrent();
    else if (name === 'auto' || name === 'enlarge-auto') autoContinue();
    else if (name === 'replay' || name === 'enlarge-replay') {
      if (locksEnabled && state.step === 2 && !state.shrinkAutoCompleted) return;
      pause();state.processed[state.step].clear();state.applied[state.step]=false;
      if (state.step === 1) state.enlarged = { x: 14, y: 10 };
      else {
        answer.removeAttribute('aria-invalid');
        state.feedback[2] = '';
        state.errors[2] = false;
        state.restoreShown = false; state.differences = false;
      }
      render();
    }
    else if (name === 'restore') {
      if (locksEnabled && !state.applied[2]) { showStep(2); return; }
      if (!state.prediction) {
        parts['comparison-feedback'].textContent = '先选择你的预测，再查看结果。';
        parts['comparison-feedback'].classList.add('error');
        return;
      }
      state.restoreShown = true;
      render();
    }
  });
  root.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.action === 'numbers') state.numbers = input.checked;
    else if (input.dataset.action === 'differences') state.differences = input.checked;
    else if (input.name === 'math-prediction') state.prediction = input.value;
    else return;
    render();
  });
  answer.addEventListener('input', saveDraft);
  answer.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); checkAnswer(); }
  });
  root.querySelector('.math-shrink-channels').addEventListener('keydown', event => {
    const tab = event.target.closest('[data-shrink-channel]');
    if (!tab || tab.disabled) return;
    const current = Number(tab.dataset.shrinkChannel);
    const next = event.key === 'ArrowRight' ? (current + 1) % 3 : event.key === 'ArrowLeft' ? (current + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
    if (next === null) return;
    event.preventDefault();
    channelTabs[next].click();
    channelTabs[next].focus({ preventScroll: true });
  });
  const observer = new ResizeObserver(() => {
    if (pendingResize) return;
    pendingResize = true;
    requestAnimationFrame(() => { pendingResize = false; drawBoards(); });
  });
  observer.observe(root);
  render();
  root.querySelectorAll('input[name="math-prediction"]').forEach(input => { input.checked = input.value === state.prediction; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { saveDraft(); pause(); storage.flush(); }
  });
  return {
    refresh: render,
    getStep: () => state.step,
    reset() {
      // 停止旧演示后重新创建实验状态，保留外部札记控制的解锁范围。
      pause();
      calculator.close();
      state = freshState();
      answer.value = '';
      answer.removeAttribute('aria-invalid');
      root.querySelectorAll('input[name="math-prediction"]').forEach(input => { input.checked = false; });
      parts['comparison-feedback'].textContent = '';
      parts['comparison-feedback'].classList.remove('error');
      render();
      onStepChange(0);
      storage.clear();
    },
    pause() { saveDraft(); pause(); calculator.close(); storage.flush(); },
    goToStep: showStep,
    setGate(steps) {
      allowedSteps = steps ? new Set(steps) : null;
      if (!canEnter(state.step)) showStep(steps[0]);
      else render();
    },
  };
}
