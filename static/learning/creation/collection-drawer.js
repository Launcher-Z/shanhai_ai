/* 9.3可拖动悬浮提示词收藏本：与右上角学习札记共用宣纸弹窗视觉与交互。 */
import { el } from './common.js';

export function createCollectionDrawer({ anchorDialog, trigger, notebook }) {
  const drawerId = 'creation-collection-drawer';
  const titleId = 'creation-collection-title';
  const drawer = el('section', undefined, 'learning-note is-collection-note creation-collection-drawer');
  drawer.id = drawerId;
  drawer.setAttribute('popover', 'manual');
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'false');
  drawer.setAttribute('aria-labelledby', titleId);
  drawer.hidden = true;

  const heading = el('header', undefined, 'note-heading');
  const dragHandle = el('button', undefined, 'note-drag');
  dragHandle.type = 'button';
  dragHandle.setAttribute('aria-label', '拖动提示词收藏本，也可用方向键移动');
  dragHandle.append(el('span'));
  dragHandle.lastChild.setAttribute('aria-hidden', 'true');

  const closeBtn = el('button', undefined, 'note-close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', '收起提示词收藏本');
  const closeIcon = el('img');
  closeIcon.src = '/static/learning/ink-close.png';
  closeIcon.alt = '';
  closeIcon.width = 32;
  closeIcon.height = 32;
  closeBtn.append(closeIcon);

  const eyebrow = el('p', '案上小纸 · 随手查阅', 'note-eyebrow');
  const headingTitle = el('h3', '我的提示词收藏本');
  headingTitle.id = titleId;
  const stateLine = el('p', '随手收藏 · 自由整理', 'note-state');
  stateLine.setAttribute('aria-live', 'polite');
  heading.append(dragHandle, closeBtn, eyebrow, headingTitle, stateLine);

  const body = el('div', undefined, 'note-body');
  const reader = el('div', undefined, 'note-reader');
  reader.setAttribute('role', 'region');
  reader.tabIndex = 0;
  reader.setAttribute('aria-label', '我的提示词收藏本，可上下滚动');
  const content = el('div', undefined, 'note-content');
  reader.append(content);
  body.append(reader);

  const foot = el('footer', undefined, 'note-foot');
  const noteMsg = el('p', '收进来的片段可在任何步骤里随时翻看和整理。', 'note-message');
  noteMsg.setAttribute('role', 'status');
  noteMsg.setAttribute('aria-live', 'polite');
  foot.append(noteMsg);

  drawer.append(heading, body, foot);
  const host = anchorDialog || trigger.closest('dialog') || document.body;
  host.append(drawer);

  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', drawerId);
  trigger.setAttribute('aria-expanded', 'false');

  function position(left, top) {
    const maxLeft = Math.max(8, document.documentElement.clientWidth - drawer.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - drawer.offsetHeight - 8);
    drawer.style.right = 'auto';
    drawer.style.left = `${Math.max(8, Math.min(maxLeft, left))}px`;
    drawer.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
  }

  let drag = null;
  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragHandle.focus();
    dragHandle.setPointerCapture(event.pointerId);
    const bounds = drawer.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
  }
  function onPointerMove(event) {
    if (drag) position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  }
  function endDrag() {
    drag = null;
  }
  function onHandleKeyDown(event) {
    const move = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
    if (!move) return;
    const bounds = drawer.getBoundingClientRect();
    event.preventDefault();
    position(bounds.left + move[0], bounds.top + move[1]);
  }
  function keepVisible() {
    if (drawer.hidden) return;
    const bounds = drawer.getBoundingClientRect();
    position(bounds.left, bounds.top);
  }

  dragHandle.addEventListener('pointerdown', onPointerDown);
  dragHandle.addEventListener('pointermove', onPointerMove);
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) dragHandle.addEventListener(t, endDrag);
  dragHandle.addEventListener('keydown', onHandleKeyDown);
  window.addEventListener('resize', keepVisible);

  function open() {
    drawer.hidden = false;
    drawer.classList.add('is-open');
    if (typeof drawer.showPopover === 'function') {
      try {
        if (!drawer.matches(':popover-open')) drawer.showPopover();
      } catch {
        // 已挂载或不支持原生 popover 时降级使用常规固定定位展示。
      }
    }
    const anchorBounds = host.getBoundingClientRect();
    const noteEl = host.querySelector('#learning-note');
    const noteOpen = Boolean(noteEl && !noteEl.hidden);
    const defaultLeft = noteOpen ? anchorBounds.left + 22 : anchorBounds.right - drawer.offsetWidth - 22;
    const defaultTop = anchorBounds.top + 76;
    const currentBounds = drawer.getBoundingClientRect();
    position(drawer.style.left ? currentBounds.left : defaultLeft, drawer.style.left ? currentBounds.top : defaultTop);
    trigger.setAttribute('aria-expanded', 'true');
    notebook.mount(content);
    noteMsg.classList.remove('error');
    noteMsg.textContent = '收进来的片段可在任何步骤里随时翻看和整理。';
    notebook
      .refresh()
      .catch((error) => {
        noteMsg.textContent = error.message;
        noteMsg.classList.add('error');
      });
    dragHandle.focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (drawer.hidden) return;
    if (typeof drawer.hidePopover === 'function') {
      try {
        if (drawer.matches(':popover-open')) drawer.hidePopover();
      } catch {
        // 忽略已收起状态。
      }
    }
    drawer.classList.remove('is-open');
    drawer.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
  }

  const onTrigger = () => {
    if (drawer.hidden) open();
    else close(true);
  };
  const onCloseBtn = () => close(true);
  const onDialogCancel = (event) => {
    if (!drawer.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    }
  };

  trigger.addEventListener('click', onTrigger);
  closeBtn.addEventListener('click', onCloseBtn);
  anchorDialog?.addEventListener('cancel', onDialogCancel, { capture: true });

  return {
    open,
    close,
    destroy() {
      close(false);
      trigger.removeEventListener('click', onTrigger);
      closeBtn.removeEventListener('click', onCloseBtn);
      anchorDialog?.removeEventListener('cancel', onDialogCancel, { capture: true });
      window.removeEventListener('resize', keepVisible);
      drawer.remove();
    },
  };
}
