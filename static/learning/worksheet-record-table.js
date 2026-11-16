/* 表格仍序列化为普通文字札记，沿用暂存、提交、审核和教师阅读流程。 */
import { createRgbRecord } from './image-code/rgb-note.js';
import { createAnimalPredictionTable } from './animal-classifier/note.js';
export function createRecordTable(question, answer, options = {}) {
  if (question.record_table.kind === 'animal_predictions') return createAnimalPredictionTable(question,answer);
  if (question.record_table.kind === 'rgb') return createRgbRecord(question,answer,options);
  if (['digit_comparison', 'handwriting_results', 'manual_training'].includes(question.record_table.kind)) return createDigitComparison(question, answer, options);
  const root = document.createElement("div");
  root.className = "note-record-grid";
  const fields = question.record_table.fields,
    inputs = new Map();
  const makeInput = (field) => {
    const input = document.createElement("input");
    input.type = "number";
    input.step = field.integer ? "1" : "any";
    input.inputMode = field.integer ? 'numeric' : 'decimal';
    input.min = field.min;
    input.max = field.max;
    input.required = Boolean(question.required);
    input.name = question.id + "__" + field.key;
    input.setAttribute("aria-label", field.label);
    inputs.set(field.label, input);
    return input;
  };
  const displacement = document.createElement("div");
  displacement.className = "note-record-displacement";
  fields.slice(0, 2).forEach((field) => {
    const label = document.createElement("label");
    label.append(
      document.createTextNode(field.label + "（像素）"),
      makeInput(field),
    );
    displacement.append(label);
  });
  const table = document.createElement("table");
  table.innerHTML =
    "<thead><tr><th>划分</th><th>相似程度（%）</th></tr></thead>";
  const body = document.createElement("tbody");
  fields.slice(2).forEach((field) => {
    const row = document.createElement("tr"),
      label = document.createElement("th"),
      cell = document.createElement("td");
    label.scope = "row";
    label.textContent = field.label;
    cell.append(makeInput(field));
    row.append(label, cell);
    body.append(row);
  });
  table.append(body);
  root.append(displacement, table);
  function restore() {
    const values = new Map(
      answer.value.split("\n").map((line) => {
        const at = line.indexOf("：");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
    );
    inputs.forEach((input, label) => {
      input.value = values.get(label) || "";
    });
  }
  let writing = false;
  root.addEventListener("input", (event) => {
    event.stopPropagation();
    answer.value = fields
      .map((field) => field.label + "：" + inputs.get(field.label).value)
      .join("\n");
    writing = true;
    try { answer.dispatchEvent(new Event("input", { bubbles: true })); }
    finally { writing = false; }
  });
  answer.addEventListener("input", () => {if (!writing) restore();});
  restore();
  return root;
}

/* 从 T1 初测记录中解析已测试图片编号（E01→0 .. E10→9），跳过未测试行。 */
function baselineHeaderDigits(text) {
  const digits = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.trim().match(/^(E(?:0[1-9]|10))\s*[:：]\s*(.+)$/);
    if (!match || /^未测试/.test(match[2].trim())) continue;
    const digit = Number(match[1].slice(1)) - 1;
    if (!digits.includes(digit)) digits.push(digit);
    if (digits.length >= 5) break;
  }
  return digits;
}

function bitsToDataUrl(bits) {
  if (typeof bits !== 'string' || !/^[01]{216}$/.test(bits)) return '';
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 120, 180);
  ctx.fillStyle = '#1f2a24';
  for (let i = 0; i < 216; i++) {
    if (bits[i] === '1') ctx.fillRect((i % 12) * 10, Math.floor(i / 12) * 10, 10, 10);
  }
  return canvas.toDataURL();
}

/* 数字实验按图片并列填写，序列化接口与其他札记表格保持一致。 */
function createDigitComparison(question, answer, options) {
  const root = document.createElement('div');
  root.className = 'note-record-grid note-digit-comparison';
  const controls = new Map();
  const slotPixels = new Map();
  const savedContext = question.handwriting_context && typeof question.handwriting_context === 'object' ? question.handwriting_context : {};
  function control(key) {
    const field = question.record_table.fields.find(item => item.key === key);
    if (key.endsWith('-correct')) {
      const group = document.createElement('div');
      group.className = 'note-judgment';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', field.label);
      const radios = [];
      field.options.forEach(value => {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio'; radio.name = `${question.id}__${key}`;
        radio.value = value; radio.required = Boolean(question.required);
        radio.setAttribute('aria-label', `${field.label}：${value}`);
        const face = document.createElement('span'); face.className = 'note-judgment-face';
        // 不规则填充笔画与纸面样式一致，文字和原生单选保留键盘、读屏能力。
        const path = value === '正确' ? 'M2 12 6 15 18 3 16 8 7 20 5 18Z' : 'M3 3 7 5 19 18 16 20 2 5ZM17 2 20 4 6 20 3 18 13 6Z';
        face.innerHTML = `<svg viewBox="0 0 22 22" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg><span>${value === '正确' ? '对' : '错'}</span>`;
        label.append(radio, face); group.append(label); radios.push(radio);
      });
      // 与数值控件使用同一个取值接口，暂存和恢复都不需要转换答案格式。
      controls.set(field.label, {
        get value() { return radios.find(radio => radio.checked)?.value || ''; },
        set value(value) { radios.forEach(radio => radio.checked = radio.value === value); }
      });
      return group;
    }
    const input = document.createElement(field.options ? 'select' : 'input');
    if (field.options) {
      input.append(new Option(field.options.length <= 2 ? '—' : '请选择', ''));
      field.options.forEach(option => input.append(new Option(option, option)));
    } else {
      input.type = 'number'; input.min = field.min; input.max = field.max;
      input.step = field.integer ? '1' : 'any';
      input.inputMode = field.integer ? 'numeric' : 'decimal';
    }
    input.name = `${question.id}__${key}`;
    input.required = Boolean(question.required);
    input.setAttribute('aria-label', field.label);
    controls.set(field.label, input);
    return input;
  }
  function table(title, headings, rows) {
    const heading = document.createElement('h5'); heading.textContent = title;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    headings.forEach(text => { const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; head.append(th); });
    const body = table.createTBody();
    rows.forEach(cells => { const row = body.insertRow(); cells.forEach(value => { const cell = row.insertCell(); if (typeof value === 'string') cell.textContent = value; else cell.append(value); }); });
    root.append(heading, table);
  }
  const pickers = [];
  const valueOf = key => controls.get(question.record_table.fields.find(field=>field.key===key).label);
  let attempts = [];
  function resolveSlotPixels(index, id, steps) {
    const matched = id !== '' && steps !== ''
      ? attempts.find(item => String(item.sourceId) === id && String(item.steps) === steps)
      : null;
    if (matched?.pixels) {
      slotPixels.set(index, matched.pixels);
      return { pixels: matched.pixels, image: matched.image || bitsToDataUrl(matched.pixels), matched };
    }
    if (id === '') {
      slotPixels.delete(index);
      return { pixels: '', image: '', matched: null };
    }
    const sameSource = attempts.find(item => String(item.sourceId) === id && item.pixels);
    const saved = savedContext[String(index)];
    const savedMatch = saved && String(saved.source_id ?? '') === id ? saved.pixels : '';
    const existing = slotPixels.get(index) || savedMatch || sameSource?.pixels || '';
    if (existing) slotPixels.set(index, existing);
    return { pixels: existing, image: existing ? bitsToDataUrl(existing) : '', matched: null };
  }
  function refreshAttempts() {
    attempts = options.getHandwritingAttempts?.() || [];
    for(const {select,preview,index} of pickers) {
      const id=valueOf(`row${index}-id`).value, steps=valueOf(`row${index}-steps`).value;
      select.replaceChildren(new Option(attempts.length?'选择一次尝试':'暂无手写尝试',''));
      attempts.forEach(item=>select.append(new Option(`手写${item.sourceId} · ${item.steps}次`,String(item.id))));
      const resolved = resolveSlotPixels(index, id, steps);
      if(resolved.matched) select.value=String(resolved.matched.id);
      else if(id!=='') {select.append(new Option(`已存：手写${id} · ${steps}次`,'saved'));select.value='saved';}
      if(resolved.image) {preview.src=resolved.image;preview.hidden=false;} else {preview.removeAttribute('src');preview.hidden=true;}
    }
  }
  if (question.record_table.kind === 'handwriting_results') {
    // 手写记录按三张图并列，避免把第一、第二预测挤成一张过宽的横表。
    const matrix = document.createElement('table');
    matrix.className = 'note-handwriting-matrix';
    const head=matrix.createTHead().insertRow();
    const refresh=document.createElement('button');refresh.type='button';refresh.className='note-refresh-attempts';refresh.textContent='更新可选尝试';refresh.onclick=refreshAttempts;
    root.append(refresh);
    const corner=document.createElement('th'); corner.scope='col'; corner.textContent='选择尝试'; head.append(corner);
    for(let i=1;i<=3;i++) {
      const cell=document.createElement('th'); cell.scope='col';
      const id=control(`row${i}-id`);id.hidden=true;id.required=false;id.className='note-record-answer';
      const select=document.createElement('select');select.required=Boolean(question.required);select.setAttribute('aria-label',`第${i}条手写尝试`);
      const preview=document.createElement('img');preview.className='note-attempt-preview';preview.alt=`第${i}条尝试的笔迹`;preview.hidden=true;
      select.addEventListener('input',event=>{
        event.stopPropagation();
        if(select.value==='saved') return;
        const item=attempts.find(item=>String(item.id)===select.value);
        const fields=item?{id:item.sourceId,steps:item.steps,'first-digit':item.firstDigit,'first-probability':item.firstProbability,'second-digit':item.secondDigit,'second-probability':item.secondProbability}:{id:'',steps:'','first-digit':'','first-probability':'','second-digit':'','second-probability':''};
        // 换一张笔迹时，实际数字由学生重新确认，不能拿模型预测充当标签。
        if(String(item?.sourceId??'')!==valueOf(`row${i}-id`).value)valueOf(`row${i}-actual`).value='';
        Object.entries(fields).forEach(([key,value])=>valueOf(`row${i}-${key}`).value=value);
        if(item?.pixels) slotPixels.set(i, item.pixels); else slotPixels.delete(i);
        if(item?.image){preview.src=item.image;preview.hidden=false;}else{preview.removeAttribute('src');preview.hidden=true;}
        root.dispatchEvent(new Event('input',{bubbles:true}));
      });
      pickers.push({select,preview,index:i});
      cell.append(id,select,preview); head.append(cell);
    }
    options.setContextGetter?.(() => {
      attempts = options.getHandwritingAttempts?.() || [];
      const payload = {};
      for (let i = 1; i <= 3; i++) {
        const id = valueOf(`row${i}-id`).value.trim();
        const steps = valueOf(`row${i}-steps`).value.trim();
        const resolved = resolveSlotPixels(i, id, steps);
        if (id !== '' && resolved.pixels) {
          payload[String(i)] = {
            source_id: Number(id),
            steps: steps === '' ? null : Number(steps),
            pixels: resolved.pixels,
          };
        }
      }
      return payload;
    });
    const body=matrix.createTBody();
    for(const [label,key] of [['你写的是','actual'],['累计次数','steps'],['第一预测','first'],['第二预测','second']]) {
      const row=body.insertRow(), heading=document.createElement('th');
      heading.scope='row'; heading.textContent=label; row.append(heading);
      if(key==='first'||key==='second') {
        const caption=document.createElement('small');caption.className='note-prediction-caption';caption.textContent='数字 / 比例';heading.append(caption);
      }
      for(let i=1;i<=3;i++) {
        const cell=row.insertCell();
        if(key==='first'||key==='second') {
          const prediction=document.createElement('div');prediction.className='note-handwriting-prediction';
          const digit=control(`row${i}-${key}-digit`);digit.className='note-prediction-digit';
          const prob=document.createElement('label'); prob.className='note-prediction-percent';
          prob.append(control(`row${i}-${key}-probability`),'%');
          prediction.append(digit,prob);cell.append(prediction);
        } else cell.append(control(`row${i}-${key}`));
      }
    }
    root.append(matrix);
  } else if (question.record_table.kind === 'manual_training') {
    const matrix = document.createElement('table');
    matrix.className = 'note-manual-matrix';
    const colgroup = document.createElement('colgroup');
    ['56px', '78px', '170px', '104px'].forEach(width => {
      const col = document.createElement('col'); col.style.width = width; colgroup.append(col);
    });
    matrix.append(colgroup);
    const head = matrix.createTHead().insertRow();
    ['次序', '标签', '预测 / 比例', '对错'].forEach(text => {
      const th = document.createElement('th'); th.scope = 'col'; th.textContent = text; head.append(th);
    });
    const body = matrix.createTBody();
    for (let i = 1; i <= 3; i++) {
      const row = body.insertRow();
      const th = document.createElement('th'); th.scope = 'row'; th.textContent = `第${i}次`;
      row.append(th);
      row.insertCell().append(control(`r${i}-label`));
      const predWrap = document.createElement('div');
      predWrap.className = 'note-handwriting-prediction';
      const predDigit = control(`r${i}-pred`);
      predDigit.className = 'note-prediction-digit';
      const probWrap = document.createElement('label');
      probWrap.className = 'note-prediction-percent';
      probWrap.append(control(`r${i}-prob`), '%');
      predWrap.append(predDigit, probWrap);
      row.insertCell().append(predWrap);
      row.insertCell().append(control(`r${i}-correct`));
    }
    root.append(matrix);
  } else if (question.record_table.layout === 'matrix') {
    // 一列固定对应一张图，每格只保留判断与比例。
    const matrix = document.createElement('table');
    matrix.className = 'note-comparison-matrix';
    const head = matrix.createTHead().insertRow();
    const corner = document.createElement('th'); corner.scope = 'col';
    corner.className = 'note-diagonal-heading';
    corner.setAttribute('aria-label', '下方为累计训练次数，右方为测试数字');
    const digitLabel = document.createElement('span'); digitLabel.className = 'note-diagonal-digit'; digitLabel.textContent = '数字';
    const countLabel = document.createElement('span'); countLabel.className = 'note-diagonal-count'; countLabel.textContent = '次数';
    corner.append(digitLabel, countLabel); head.append(corner);
    for (let i=1;i<=5;i++) {
      const cell=document.createElement('th'); cell.scope='col'; cell.append(control(`image-${i}`)); head.append(cell);
    }
    const body=matrix.createTBody();
    for (const stage of ['0','101','401','custom']) {
      const row=body.insertRow();
      const label=document.createElement('th'); label.scope='row';
      if (stage==='custom') { label.append('自选',control('custom-steps')); }
      else label.textContent=stage;
      row.append(label);
      for (let i=1;i<=5;i++) {
        const cell=row.insertCell();
        const percent=document.createElement('label'); percent.className='note-cell-percent';
        percent.append(control(`${stage}-${i}-probability`),'%');
        cell.append(control(`${stage}-${i}-correct`),percent);
      }
    }
    root.append(matrix);
  } else {
    // 已保存的旧表格仍按原字段回看，避免丢失学生作答。
    table('选定同五张测试图', ['序号', '图片编号', '实际数字'], Array.from({length:5}, (_,i) => [String(i+1),control(`image-${i+1}`),control(`digit-${i+1}`)]));
    for (const stage of ['101','401','custom']) {
    if (stage === 'custom') {
      const label = document.createElement('label'); label.className = 'note-custom-steps';
      label.append('自选累计训练次数', control('custom-steps')); root.append(label);
    }
    table(stage === 'custom' ? '自选次数后' : `累计${stage}次后`, ['图片', '预测数字', '对错', '比例（%）'], Array.from({length:5}, (_,i) => [String(i+1), control(`${stage}-${i+1}-prediction`),control(`${stage}-${i+1}-correct`),control(`${stage}-${i+1}-probability`)]));
    }
  }
  function serialize() {
    return question.record_table.fields.map(field => `${field.label}：${controls.get(field.label).value}`).join('\n');
  }
  function prefillBaselineDigits() {
    if (question.id !== 'ten-comparison' || question.record_table.layout !== 'matrix' || question.editable === false) return;
    if ([1, 2, 3, 4, 5].some(i => valueOf(`image-${i}`).value !== '')) return;
    const fromLab = (options.getBaselineDigits?.() || []).slice(0, 5);
    const digits = fromLab.length ? fromLab : baselineHeaderDigits(options.getBaselineRecord?.());
    if (!digits.length) return;
    digits.forEach((digit, index) => { valueOf(`image-${index + 1}`).value = String(digit); });
    answer.value = serialize();
  }
  function restore() {
    const values = new Map(answer.value.split('\n').map(line => { const at=line.indexOf('：'); return [line.slice(0,at),line.slice(at+1)]; }));
    controls.forEach((input,label) => input.value = values.get(label) || '');
    prefillBaselineDigits();
    if(pickers.length) refreshAttempts();
  }
  let writing = false;
  root.addEventListener('input', event => {
    event.stopPropagation();
    answer.value = serialize();
    // 自己序列化时不恢复控件，保留数字输入中间态，例如尚未输完的“72.”。
    writing = true;
    try { answer.dispatchEvent(new Event('input',{bubbles:true})); }
    finally { writing = false; }
  });
  answer.addEventListener('input',()=>{if(!writing)restore();}); restore();
  return root;
}
