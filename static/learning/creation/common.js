/* 只有主动保存的札记附件和收藏进入服务器，候选图片留在本机。 */
export const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
export async function api(path, body) {
  const options =
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
          body: body instanceof FormData ? body : JSON.stringify(body),
        };
  if (body !== undefined && !(body instanceof FormData)) options.headers['Content-Type'] = 'application/json';
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '连接失败，请稍后再试。');
  return data;
}
export function button(text, action) {
  const b = el('button', text);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await action();
    } catch (e) {
      const host = b.closest('.creation-panel,.creation-form') || b.parentElement;
      let p = host.querySelector('.creation-error');
      if (!p) {
        p = el('p', '', 'creation-error');
        p.setAttribute('role', 'alert');
        host.append(p);
      }
      p.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
export function field(host, label, value, change, options) {
  const wrap = el('label', label),
    input = el(options ? 'select' : 'textarea');
  input.setAttribute('aria-label', label);
  if (options)
    options.forEach(([v, t]) => {
      const o = el('option', t);
      o.value = v;
      input.append(o);
    });
  else {
    input.rows = 3;
    input.maxLength = 12000;
  }
  input.value = value || '';
  input.addEventListener('input', () => change(input.value));
  wrap.append(input);
  host.append(wrap);
  return input;
}
export const matches = [
  ['', '请选择'],
  ['met', '符合'],
  ['partial', '部分符合'],
  ['unmet', '不符合'],
];
export const blankWork = () => ({
  key: crypto.randomUUID(),
  title: '',
  prompt: '',
  media_id: '',
  tool: { mode: 'external', name: '', model: '' },
  ai_optimization: {
    used: false,
    mode: 'external',
    tool_name: '文心一言',
    original_prompt: '',
    suggested_prompt: '',
  },
});
export function renderStepNav(nav, steps, current, filledList, onSelect) {
  nav.replaceChildren();
  steps.forEach(([num, label], index) => {
    const tab = el('button', undefined, 'creation-step-tab');
    tab.type = 'button';
    if (current === index) tab.setAttribute('aria-current', 'step');
    if (filledList[index]) tab.classList.add('is-filled');
    tab.append(el('span', num, 'creation-step-seal'), el('span', label, 'creation-step-name'));
    tab.addEventListener('click', () => onSelect(index));
    nav.append(tab);
  });
}
export function buildStepFooter(prevIndex, nextIndex, nextLabel, onGo) {
  const foot = el('div', undefined, 'creation-step-foot');
  if (prevIndex !== null) {
    foot.append(button('← 上一步', () => onGo(prevIndex)));
  }
  if (nextIndex !== null) {
    const nextBtn = button(nextLabel, () => onGo(nextIndex));
    nextBtn.classList.add('is-primary');
    foot.append(nextBtn);
  }
  return foot;
}
export async function uploadCreationMedia(blob, activityId) {
  const form = new FormData();
  form.append('file', blob, '作品.png');
  form.append('activity_id', activityId);
  form.append('csrf', document.querySelector('meta[name="csrf-token"]').content);
  return api('/api/creation/media', form);
}
export function renderScoreRails(host, qId, evaluation, criteria, onChange, { compact = false } = {}) {
  for (const [key, title, hint] of criteria) {
    const group = el('fieldset', undefined, 'original-score');
    group.append(el('legend', title), el('p', hint));
    const rail = el('div', undefined, 'original-score-rail');
    for (let score = 0; score <= 5; score++) {
      const label = el('label');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = `${qId}-${key}`;
      radio.value = String(score);
      radio.checked = evaluation[key] === score;
      radio.setAttribute('aria-label', `${title} ${score}分`);
      radio.addEventListener('change', () => {
        evaluation[key] = score;
        onChange();
      });
      label.append(radio, el('span', String(score)));
      rail.append(label);
    }
    group.append(rail);
    if (!compact) {
      group.append(el('small', '0分：完全未体现 · 5分：非常理想'));
    }
    host.append(group);
  }
}
export function appendPhrase(current, phrase) {
  const clean = (current || '').trim();
  if (!clean) return phrase;
  if (clean.includes(phrase)) return clean;
  return `${clean.replace(/[，,、\s]+$/, '')}，${phrase}`;
}
export function pictureLink(image, className = '') {
  const link = el('a', undefined, className);
  link.href = image.src;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = '点击查看大图';
  link.setAttribute('aria-label', '查看原尺寸作品');
  link.append(image);
  return link;
}
export function createNoteBlock(title, variant, badgeText = '') {
  const block = el('section', undefined, `creation-note-block ${variant}`);
  const head = el('div', undefined, 'creation-note-block-head');
  const titleNode = el('h5', title, 'creation-note-block-title');
  head.append(titleNode);
  if (badgeText) {
    head.append(el('span', badgeText, 'creation-note-block-badge'));
  }
  block.append(head);
  return { block, head, titleNode };
}
export function createLabeledTextarea(head, labelText, id, value, onChange, rows = 3, placeholder = '') {
  const label = el('label', labelText, 'creation-note-block-label');
  label.htmlFor = id;
  head.prepend(label);
  const input = el('textarea');
  input.id = id;
  input.rows = rows;
  input.maxLength = 12000;
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener('input', () => onChange(input.value));
  return input;
}
export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = el('textarea');
    t.value = text;
    document.body.append(t);
    t.select();
    if (!document.execCommand('copy')) throw new Error('请选中文字手动复制。');
    t.remove();
  }
}
