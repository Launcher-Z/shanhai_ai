/* 活动区只做实验；札记输入、提交、成绩与解锁交给公共札记控制器。 */
const ACTIVITY_ID = 'lesson-1-task-1';
const HEADINGS = [
  ['在小格子里，画一个“1”', '点击方格，把它涂黑。'],
  ['同一幅图，也能写成一串数字', '按黑白约定，点击右侧方格切换0与1，完成后点击“验证转换”。'],
  ['能给8种灰度，各取一个不同的编码吗？', '每格只用0和1，填满所选位数。试试能否让8格的编码互不重复。'],
  ['三个数值，调出一种颜色', '改变红、绿、蓝的强弱，为像素调出自己的颜色。'],
];
const PRESETS = [[255,0,0], [0,255,0], [0,0,255], [255,255,0], [255,255,255], [0,0,0]];
const grayValue = index => Math.round(index * 255 / 7);
const rgb = values => `rgb(${values.join(', ')})`;
const initialGrayCodes = () => ({1:['0','1','','','','','',''], 2:Array(8).fill(''), 3:Array(8).fill('')});
const initialState = () => ({
  step: 0, pixels: Array(25).fill(0), white: 0, codes: Array(25).fill(0), checked: false,
  selected: 0, bits: 1, grayCodes: initialGrayCodes(), grayChecked: false, rgb: [128,64,32], colors: null,
});

export function mountImageCode(root, onStepChange) {
  const ui = Object.fromEntries([...root.querySelectorAll('[data-code-ui]')].map(el => [el.dataset.codeUi, el]));
  const steps = [...root.querySelectorAll('[data-code-step]')];
  const studentId = root.dataset.studentId;
  const storageKey = studentId ? `shanhai:experiment:${studentId}:${ACTIVITY_ID}` : null;
  let state = initialState();
  let gate = null;
  let timer;
  let dirty = false;

  // 只接收当前学生、当前活动、当前版本的轻量点阵；坏记录不阻断课堂。
  function restore() {
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (![1,2,3].includes(saved?.version) || saved.studentId !== studentId || saved.activityId !== ACTIVITY_ID) return;
      const data = saved.state;
      const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
      const color = value => Array.isArray(value) && value.length === 3 && value.every(v => integer(v, 0, 255));
      if (!data || !integer(data.step,0,3) || !Array.isArray(data.pixels) || data.pixels.length !== 25
          || !data.pixels.every(v => v === 0 || v === 1) || !integer(data.white,0,1)
          || !integer(data.selected,0,24) || !integer(data.bits,1,3)
          || !color(data.rgb) || !(data.colors === null || Array.isArray(data.colors) && data.colors.length === 25 && data.colors.every(color))) return;
      // 旧版只恢复原图和参数，自动生成的答案不能变成学生手填结果。
      const grayCodesValid = saved.version === 3 && [1,2,3].every(bits => Array.isArray(data.grayCodes?.[bits])
        && data.grayCodes[bits].length === 8 && data.grayCodes[bits].every(code => typeof code === 'string' && code.length <= bits));
      state = {...initialState(), ...data, codes: saved.version >= 2 && Array.isArray(data.codes)
        && data.codes.length === 25 && data.codes.every(v => v === 0 || v === 1) ? data.codes : Array(25).fill(0), checked: saved.version >= 2 && data.checked === true,
        grayCodes: grayCodesValid ? data.grayCodes : initialGrayCodes(), grayChecked: grayCodesValid && data.grayChecked === true};
      delete state.encoded; delete state.numbers; delete state.gray;
    } catch { /* 本地存储不可用时仍能操作实验。 */ }
  }

  function save() {
    clearTimeout(timer);
    if (!dirty || !storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        version: 3, studentId, activityId: ACTIVITY_ID, savedAt: new Date().toISOString(), state,
      }));
      dirty = false;
    } catch { /* 不把本地保存失败传递给服务器札记或完成状态。 */ }
  }

  function changed() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(save, 250);
  }
  const canEnter = step => !gate || gate.has(step);
  const bitAt = index => state.pixels[index] ? 1 - state.white : state.white;

  function makeGrid(name, editable) {
    const grid = root.querySelector(`[data-code-grid="${name}"]`);
    const cells = Array.from({length:25}, (_, index) => {
      const cell = document.createElement(editable ? 'button' : 'span');
      if (editable) {
        cell.type = 'button'; cell.tabIndex = index === 0 ? 0 : -1;
        cell.addEventListener('click', () => {
          // 绘图以0/1记录是否涂黑，显示编码时再应用学生选择的黑白约定。
          if (name === 'draw') { state.pixels[index] = 1 - state.pixels[index]; state.checked = false; }
          if (name === 'encoded') { state.selected = index; state.codes[index] = 1 - state.codes[index]; state.checked = false; }
          if (name === 'color') state.colors[index] = [...state.rgb];
          cells.forEach((item, position) => { item.tabIndex = position === index ? 0 : -1; });
          render(); changed();
        });
        cell.addEventListener('keydown', event => {
          const moves = {ArrowLeft:-1, ArrowRight:1, ArrowUp:-5, ArrowDown:5};
          if (!(event.key in moves)) return;
          event.preventDefault();
          const column = index % 5;
          if (event.key === 'ArrowLeft' && column === 0 || event.key === 'ArrowRight' && column === 4) return;
          const next = index + moves[event.key];
          if (next < 0 || next > 24) return;
          cells.forEach((item, position) => { item.tabIndex = position === next ? 0 : -1; });
          cells[next].focus();
        });
      }
      grid.append(cell);
      return cell;
    });
    return cells;
  }

  restore();
  const drawing = makeGrid('draw', true);
  const source = makeGrid('source', false);
  const encoded = makeGrid('encoded', true);
  const colored = makeGrid('color', true);
  const mapping = root.querySelector('#code-mapping');
  const verify = root.querySelector('[data-code-action="verify"]');
  const previous = root.querySelector('[data-code-action="previous"]');
  const next = root.querySelector('[data-code-action="next"]');
  const channels = [...root.querySelectorAll('[data-code-channel]')];
  const channelValues = [...root.querySelectorAll('[data-code-value]')];

  // 八张卡片始终保持同一顺序；输入框不重建，便于连续打字和键盘移动。
  const grayCards = Array.from({length:8}, (_,index) => {
    const card = document.createElement('label');
    card.className = 'code-gray-card';
    const swatch = document.createElement('span');
    swatch.className = 'code-gray-color';
    swatch.style.backgroundColor = rgb(Array(3).fill(grayValue(index)));
    swatch.style.color = index < 4 ? '#fff' : '#202020';
    const name = index === 0 ? '黑' : index === 7 ? '白' : `灰${index}`;
    swatch.textContent = name;
    // 上方连续灰度条与下方填写卡片共用同一组颜色，始终从黑排到白。
    const stripSwatch = swatch.cloneNode(true);
    stripSwatch.setAttribute('aria-hidden','true');
    ui['gray-strip'].append(stripSwatch);
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'numeric'; input.autocomplete = 'off';
    input.spellcheck = false; input.dataset.grayInput = index;
    const status = document.createElement('span');
    status.className = 'code-gray-status';
    status.id = `code-gray-status-${index}`; input.setAttribute('aria-describedby',status.id);
    input.addEventListener('input',() => {
      state.grayCodes[state.bits][index] = input.value; state.grayChecked = false; render(); changed();
    });
    card.append(swatch,input,status); ui['gray-cards'].append(card);
    return {card,input,status,name};
  });

  function renderGrayCodes() {
    const codes = state.grayCodes[state.bits];
    const pattern = new RegExp(`^[01]{${state.bits}}$`);
    const valid = codes.filter(code => pattern.test(code));
    const counts = new Map();
    valid.forEach(code => counts.set(code,(counts.get(code) || 0)+1));
    grayCards.forEach(({card,input,status,name},index) => {
      input.value = codes[index]; input.maxLength = state.bits;
      input.placeholder = '·'.repeat(state.bits); input.pattern = `[01]{${state.bits}}`;
      input.setAttribute('aria-label',`${name}的${state.bits}位编码`);
      const incomplete = !pattern.test(codes[index]);
      const repeated = !incomplete && counts.get(codes[index]) > 1;
      card.dataset.repeated = String(state.grayChecked && repeated);
      input.setAttribute('aria-invalid',String(state.grayChecked && (incomplete || repeated)));
      status.textContent = !state.grayChecked ? `${state.bits}位编码` : incomplete ? `请填满${state.bits}位0或1` : repeated ? '编码重复' : '';
    });
    ui['gray-example'].hidden = state.bits !== 1;
    const feedback = ui['gray-feedback'];
    if (!state.grayChecked) feedback.textContent = '填好后验证，看看哪些灰度还不能单独区分。';
    else if (valid.length < 8) feedback.textContent = `还有${8-valid.length}格未填完整或含有其他字符。目前写出了${counts.size}种不同编码。`;
    else if (counts.size < 8) feedback.textContent = `8格用了${counts.size}种不同编码，标出的编码重复了。还能找到其他不重复的编码吗？`;
    else feedback.textContent = '8格的编码全部不同，8种灰度都能单独区分。';
    feedback.classList.toggle('is-success',state.grayChecked && counts.size === 8);
  }

  function render() {
    root.dataset.currentStep = state.step;
    ui.heading.textContent = HEADINGS[state.step][0];
    ui.intro.textContent = HEADINGS[state.step][1];
    root.querySelectorAll('[data-code-panel]').forEach(panel => { panel.hidden = Number(panel.dataset.codePanel) !== state.step; });
    steps.forEach((button, index) => {
      button.disabled = !canEnter(index);
      if (index === state.step) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
    });
    previous.disabled = state.step === 0 || !canEnter(state.step - 1);
    next.textContent = state.step === 3 ? '填写本段札记' : canEnter(state.step + 1) ? '下一步 →' : '填写札记，继续探索';
    ui['step-label'].textContent = `0${state.step + 1} / 04`;
    ui['draw-count'].textContent = `已涂黑 ${state.pixels.filter(Boolean).length} 格`;
    mapping.value = String(state.white);
    drawing.forEach((cell,index) => {
      cell.setAttribute('aria-pressed',String(Boolean(state.pixels[index])));
      cell.setAttribute('aria-label',`第${Math.floor(index/5)+1}行第${index%5+1}列，${state.pixels[index] ? '黑色' : '白色'}`);
      source[index].style.backgroundColor = state.pixels[index] ? '#151515' : '#fff';
      const output = encoded[index];
      output.textContent = state.codes[index];
      output.dataset.selected = String(state.selected === index);
      output.dataset.wrong = String(state.checked && state.codes[index] !== bitAt(index));
      output.setAttribute('aria-label',`第${Math.floor(index/5)+1}行第${index%5+1}列，当前${state.codes[index]}，点击切换`);
    });
    const wrong = state.codes.filter((value,index) => value !== bitAt(index)).length;
    ui.verification.textContent = !state.checked ? '右侧每格从0开始，点击可切换为1。' : wrong
      ? `还有${wrong}格需要修改，已标出位置。` : '25格全部一致，转换正确。';
    ui.verification.classList.toggle('is-wrong',state.checked && wrong > 0);
    ui.sequence.replaceChildren();
    // 序列只展示学生自己的填写，不从原图自动生成答案。
    for (let row=0; row<5; row++) {
      const group = document.createElement('span');
      for (let column=0; column<5; column++) {
        const index = row*5+column, digit = document.createElement('b');
        digit.textContent = state.codes[index]; digit.dataset.selected = String(index === state.selected); group.append(digit);
      }
      ui.sequence.append(group);
    }
    ui.position.textContent = `第${Math.floor(state.selected/5)+1}行第${state.selected%5+1}列 → 序列第${state.selected+1}位：${state.codes[state.selected]}`;
    root.querySelectorAll('[name="code-bit-count"]').forEach(input => { input.checked = Number(input.value) === state.bits; });
    renderGrayCodes();
    channels.forEach((input,index) => { input.value = state.rgb[index]; channelValues[index].textContent = state.rgb[index]; });
    ui['color-chip'].style.backgroundColor = rgb(state.rgb);
    ui.rgb.textContent = `RGB (${state.rgb.join(', ')})`;
    colored.forEach((cell,index) => {
      const value = state.colors?.[index] || [255,255,255];
      cell.style.backgroundColor = rgb(value);
      cell.setAttribute('aria-label',`第${Math.floor(index/5)+1}行第${index%5+1}列，RGB ${value.join(',')}`);
    });
    root.dispatchEvent(new Event('image-code:context-change'));
  }

  function goToStep(step) {
    if (!Number.isInteger(step) || step < 0 || step > 3 || !canEnter(step)) return;
    const moved = state.step !== step;
    state.step = step;
    if (step === 3 && !state.colors) {
      state.colors = state.pixels.map(value => value ? [21,21,21] : [255,255,255]);
      changed();
    }
    render();
    if (moved) { changed(); save(); }
    onStepChange(step);
  }

  steps.forEach((button,index) => button.addEventListener('click',() => goToStep(index)));
  mapping.addEventListener('change',() => { state.white = Number(mapping.value); state.checked = false; render(); changed(); });
  verify.addEventListener('click',() => { state.checked = true; render(); changed(); });
  root.querySelectorAll('[name="code-bit-count"]').forEach(input => input.addEventListener('change',() => {
    state.bits = Number(input.value); state.grayChecked = false; render(); changed();
  }));
  root.querySelector('[data-code-action="verify-gray"]').addEventListener('click',() => {state.grayChecked=true;render();changed();});
  channels.forEach((input,index) => input.addEventListener('input',() => { state.rgb[index] = Number(input.value); render(); changed(); }));
  root.querySelectorAll('[data-code-preset]').forEach(button => button.addEventListener('click',() => {
    state.rgb = [...PRESETS[Number(button.dataset.codePreset)]]; render(); changed();
  }));
  previous.addEventListener('click',() => goToStep(state.step-1));
  next.addEventListener('click',() => {
    if (state.step === 3 || !canEnter(state.step+1)) {
      root.dispatchEvent(new CustomEvent('worksheet:open',{bubbles:true,detail:{step:state.step}}));
    } else goToStep(state.step+1);
  });
  window.addEventListener('pagehide',save);
  render();
  return {
    refresh: render, pause: save, goToStep, getStep: () => state.step,
    currentRGB: () => [...state.rgb],
    worksheetContext(step) { return step === 1 ? {pixels:[...state.pixels], white:state.white} : undefined; },
    onContextChange(listener) {
      root.addEventListener('image-code:context-change',listener);
      return () => root.removeEventListener('image-code:context-change',listener);
    },
    setGate(steps) {
      gate = steps ? new Set(steps) : null;
      if (!canEnter(state.step)) goToStep(steps[0]); else render();
    },
    reset() {
      clearTimeout(timer); dirty = false;
      try { if (storageKey) localStorage.removeItem(storageKey); } catch { /* 仍可清空页面状态。 */ }
      state = initialState(); render(); onStepChange(0);
    },
  };
}
