/* RGB学习单仍保存为可读文字；代入与调色只修改草稿，不自动提交。 */
export function createRgbRecord(question, answer, options) {
  const root = document.createElement('div'); root.className = 'note-rgb-record';
  const legacy = document.createElement('p'); legacy.className = 'note-rgb-legacy'; legacy.hidden = true;
  const layout = document.createElement('div'); layout.className = 'note-rgb-layout';
  const controls = document.createElement('div'); controls.className = 'note-rgb-controls';
  const inputs = question.record_table.fields.map((field,index) => {
    const label = document.createElement('label'); label.dataset.channel = index;
    const name = document.createElement('span'); name.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'number'; input.min = 0; input.max = 255; input.step = 1; input.inputMode = 'numeric';
    input.name = `${question.id}__${field.key}`; input.required = Boolean(question.required);
    input.setAttribute('aria-label',`${field.label}数值，0到255`);
    label.append(name,input); controls.append(label); return input;
  });
  const preview = document.createElement('figure'); preview.className = 'note-rgb-preview';
  const swatch = document.createElement('div'); swatch.className = 'note-rgb-swatch'; swatch.setAttribute('role','img');
  const caption = document.createElement('figcaption'); preview.append(swatch,caption);
  layout.append(controls,preview);
  const importButton = document.createElement('button'); importButton.type = 'button';
  importButton.className = 'note-rgb-import'; importButton.textContent = '代入当前RGB';
  root.append(legacy,layout,importButton);

  const valid = values => values.every(value => value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 255);
  function paint() {
    const values = inputs.map(input=>input.value);
    const ready = valid(values);
    swatch.classList.toggle('is-empty',!ready);
    swatch.style.backgroundColor = ready ? `rgb(${values.join(',')})` : '';
    swatch.setAttribute('aria-label',ready ? `颜色预览，RGB ${values.join('，')}` : '尚未填写完整的RGB颜色');
    caption.textContent = ready ? `RGB (${values.join(', ')})` : '填写0—255的整数';
  }

  // 新记录按R/G/B三行恢复；旧文字中的R=、R＝等写法也可还原数值。
  function restore() {
    const text = answer.value;
    let found = false;
    inputs.forEach((input,index) => {
      const channel = ['R','G','B'][index];
      const match = text.match(new RegExp(`${channel}\\s*[:：=＝]\\s*([0-9.eE+-]*)`,'i'));
      input.value = match?.[1] || ''; found ||= Boolean(match);
    });
    legacy.hidden = !text.trim() || found;
    legacy.textContent = legacy.hidden ? '' : `原记录：${text}`;
    if (found) answer.value = question.record_table.fields.map((field,index)=>`${field.label}：${inputs[index].value}`).join('\n');
    paint();
  }
  let writing = false;
  function write() {
    legacy.hidden = true;
    answer.value = question.record_table.fields.map((field,index)=>`${field.label}：${inputs[index].value}`).join('\n');
    paint(); writing = true;
    try { answer.dispatchEvent(new Event('input',{bubbles:true})); }
    finally { writing = false; }
  }
  root.addEventListener('input',event=>{event.stopPropagation();write();});
  answer.addEventListener('input',()=>{if(!writing)restore();});
  importButton.addEventListener('click',()=>{
    const values = options.getCurrentRGB?.();
    if (!Array.isArray(values) || values.length !== 3 || !valid(values)) return;
    inputs.forEach((input,index)=>{input.value=values[index];}); write();
  });
  restore(); return root;
}
