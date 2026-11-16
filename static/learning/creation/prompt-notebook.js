/* 收藏本复用服务器个人笔记，独立于评分札记；不设置收藏数量或完成任务。 */
import { api, el, button, copy } from './common.js';

const notebooks = new Map();
const supportsFieldSizing = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');

let uid = 0;

function elasticTextarea(host, { id, label, value, placeholder, rows = 1, kind = '', onInput, onSubmit }) {
  const wrap = el('div', undefined, `growable-textarea${kind ? ` ${kind}` : ''}`);
  const textarea = el('textarea');
  if (id) textarea.id = id;
  if (label) textarea.setAttribute('aria-label', label);
  if (placeholder) textarea.placeholder = placeholder;
  textarea.rows = rows;
  textarea.maxLength = 12000;
  textarea.value = value || '';
  if (!supportsFieldSizing) wrap.dataset.replicatedValue = textarea.value;

  textarea.addEventListener('input', () => {
    if (!supportsFieldSizing) wrap.dataset.replicatedValue = textarea.value;
    onInput(textarea.value);
  });
  if (onSubmit) {
    textarea.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        onSubmit();
      }
    });
  }

  wrap.append(textarea);
  host.append(wrap);
  return textarea;
}

export function promptNotebook(studentId) {
  if (notebooks.has(studentId)) return notebooks.get(studentId);
  const element = el('div', undefined, 'creation-form prompt-notebook');
  const drafts = new Map();
  let items = [],
    manual = '',
    statusText = '',
    version = 0;

  function apply(result, nextStatus = '') {
    ++version;
    items = result.items;
    statusText = nextStatus;
    render();
    document.dispatchEvent(new CustomEvent('creation:favorites-changed'));
  }

  function render() {
    element.replaceChildren();
    const compose = el('section', undefined, 'prompt-notebook-compose');
    const composeHead = el('div', undefined, 'prompt-notebook-compose-head');
    const inputId = `prompt-notebook-compose-${++uid}`;
    const composeLabel = el('label', '记下一段有用的表达', 'prompt-notebook-compose-title');
    composeLabel.htmlFor = inputId;

    const saveCompose = async () => {
      if (!manual.trim()) {
        manualInput.focus();
        return;
      }
      const result = await api('/api/creation/favorites', { source_type: 'manual', content: manual });
      manual = '';
      apply(result, '已记入收藏本');
    };
    const saveBtn = button('保存笔记', saveCompose);
    saveBtn.classList.add('is-primary', 'is-compact');
    composeHead.append(composeLabel, saveBtn);
    compose.append(composeHead);

    const manualInput = elasticTextarea(compose, {
      id: inputId,
      value: manual,
      placeholder: '写下好用的画面短语、配色搭配，或自己的修改灵感（Ctrl+Enter 保存）',
      rows: 2,
      kind: 'is-compose',
      onInput: (value) => {
        manual = value;
      },
      onSubmit: saveCompose,
    });
    element.append(compose);

    const status = el('p', statusText, 'prompt-notebook-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    element.append(status);

    if (!items.length) {
      element.append(el('p', '遇到喜欢的提示词就收进来，也可以在上方随时记下一段灵感。', 'prompt-notebook-empty'));
      return;
    }

    const listHead = el('div', undefined, 'prompt-notebook-list-head');
    listHead.append(
      el('span', `已收藏 ${items.length} 条`, 'prompt-notebook-count'),
      el('small', '点击正文即可修改', 'prompt-notebook-hint'),
    );
    element.append(listHead);

    const list = el('div', undefined, 'prompt-notebook-list');
    for (const item of items) {
      const card = el('article', undefined, 'prompt-notebook-item');
      const source = item.snapshot.title || item.snapshot.source || '个人笔记';
      const isCommunity = Boolean(item.snapshot.author || item.source_type === 'gallery');
      const authorLabel = [item.snapshot.class_name, item.snapshot.author].filter(Boolean).join(' · ');
      const sourceText = authorLabel ? `${source} · ${authorLabel}` : source;

      const draft = drafts.get(item.id);
      const revision = draft?.revision ?? item.revision;
      let content = draft?.content ?? item.content;
      const syncDirty = () => card.classList.toggle('is-dirty', content !== item.content);
      syncDirty();

      const head = el('header', undefined, 'prompt-notebook-item-head');
      const badge = el('small', sourceText, `prompt-notebook-source${isCommunity ? ' is-community' : ''}`);
      const tools = el('div', undefined, 'prompt-notebook-tools');
      const copyBtn = button('复制', () => {
        copy(content);
        status.textContent = '已复制这段提示词';
      });
      copyBtn.classList.add('is-ghost');
      const deleteBtn = button('删除笔记', async () => {
        const result = await api(`/api/creation/favorites/${item.id}/delete`, { revision });
        drafts.delete(item.id);
        apply(result, '已移除该条笔记');
      });
      deleteBtn.classList.add('is-ghost', 'is-danger');
      tools.append(copyBtn, deleteBtn);
      head.append(badge, tools);
      card.append(head);

      const saveEdit = async () => {
        const result = await api(`/api/creation/favorites/${item.id}/save`, { revision, content });
        drafts.delete(item.id);
        apply(result, '已保存修改');
      };

      elasticTextarea(card, {
        label: '摘录',
        value: content,
        placeholder: '输入提示词内容…',
        rows: 1,
        kind: 'is-excerpt',
        onInput: (value) => {
          content = value;
          if (value === item.content) drafts.delete(item.id);
          else drafts.set(item.id, { content: value, revision });
          syncDirty();
        },
        onSubmit: saveEdit,
      });

      const foot = el('div', undefined, 'prompt-notebook-item-foot');
      const saveEditBtn = button('保存修改', saveEdit);
      saveEditBtn.classList.add('is-primary', 'is-compact');
      foot.append(el('small', '内容已修改', 'prompt-notebook-dirty-tip'), saveEditBtn);
      card.append(foot);
      list.append(card);
    }
    element.append(list);
  }

  const notebook = {
    mount(host) {
      host.replaceChildren(element);
      render();
    },
    async refresh() {
      const request = ++version;
      const result = await api('/api/creation/favorites');
      if (request !== version) return;
      items = result.items;
      statusText = '';
      render();
    },
    async collect(item, content) {
      apply(await api('/api/creation/favorites', { source_type: 'gallery', source_id: item.id, content }), '已收入提示词收藏本');
    },
  };
  notebooks.set(studentId, notebook);
  return notebook;
}
