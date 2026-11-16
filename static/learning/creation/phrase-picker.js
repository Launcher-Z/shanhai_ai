/* 造境与画风标签组：仅对带参考图或色板的词条展示悬停/聚焦预览浮框，并标明词条仅供参考。 */
import { el } from './common.js';

const COLOR_SWATCHES = {
  color_cold_gold: { bg: '#20364c', cat: '#51718f', accent: '#f3c65a', dots: ['#20364c', '#51718f', '#f3c65a'] },
  color_jade_gold: { bg: '#2d6156', cat: '#5b9a7e', accent: '#ebd07b', dots: ['#2d6156', '#5b9a7e', '#ebd07b'] },
  color_ink_red: { bg: '#eae4d2', cat: '#2d2f2b', accent: '#c53d2d', dots: ['#2d2f2b', '#eae4d2', '#c53d2d'] },
  color_black_gold: { bg: '#1b1d22', cat: '#33312d', accent: '#e7ad37', dots: ['#1b1d22', '#4a4337', '#e7ad37'] },
  color_moon_indigo: { bg: '#dde6ef', cat: '#8da6be', accent: '#365474', dots: ['#eef3f8', '#8da6be', '#365474'] },
};

function svgNode(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function renderColorSvg(palette) {
  const svg = svgNode('svg', { viewBox: '0 0 240 148', role: 'img', 'aria-hidden': 'true' });
  svg.append(
    svgNode('rect', { width: 240, height: 148, fill: palette.bg }),
    svgNode('path', { d: 'M0 118 Q68 98 140 116 T240 112 V148 H0Z', fill: palette.cat, opacity: '0.45' }),
  );
  const cat = svgNode('g', {
    transform: 'translate(66,28) scale(0.78)',
    fill: palette.cat,
    stroke: palette.accent,
    'stroke-width': 2,
  });
  cat.append(
    svgNode('ellipse', { cx: 60, cy: 76, rx: 28, ry: 23 }),
    svgNode('path', { d: 'M34 58 L30 28 L47 40 Q57 34 66 40 L80 27 L78 57 Q56 75 34 58Z' }),
    svgNode('path', { d: 'M85 84 Q122 80 105 56', fill: 'none', 'stroke-width': 7, 'stroke-linecap': 'round' }),
    svgNode('path', { d: 'M47 50 H51 M64 50 H68', stroke: palette.accent, 'stroke-width': 2.4 }),
  );
  svg.append(cat, svgNode('circle', { cx: 146, cy: 72, r: 8, fill: palette.accent }));
  palette.dots.forEach((hex, idx) => {
    svg.append(svgNode('circle', { cx: 22 + idx * 22, cy: 130, r: 7, fill: hex, stroke: '#ffffffaa', 'stroke-width': 1.2 }));
  });
  return svg;
}

function hasPreview(opt) {
  return Boolean(opt.preview_image || (opt.preview_key && COLOR_SWATCHES[opt.preview_key]));
}

export function createPhrasePicker({ library, onPick }) {
  const groups = (library || []).filter(
    (item) => item.id !== 'detail_compare' && (item.options?.length || item.phrases?.length),
  );
  const root = el('div', undefined, 'creation-quick-phrases');
  const notice = el('p', undefined, 'creation-phrases-notice');
  notice.append(
    el('strong', '仅供参考'),
    el('span', '以下词条只作抛砖引玉，鼓励按自己的想法自由改写或另起新词；悬停带预览的风格与色彩词条可看大致效果。'),
  );
  root.append(notice);

  const card = el('div', undefined, 'creation-preview-card');
  const cardId = `creation-preview-${crypto.randomUUID().slice(0, 8)}`;
  card.id = cardId;
  card.setAttribute('role', 'tooltip');
  const supportsPopover = typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
  if (supportsPopover) {
    card.setAttribute('popover', 'manual');
  } else {
    card.hidden = true;
  }

  const arrow = el('span', undefined, 'creation-preview-arrow');
  const visual = el('div', undefined, 'creation-preview-visual');
  const body = el('div', undefined, 'creation-preview-body');
  const titleEl = el('strong');
  const descEl = el('p');
  body.append(titleEl, descEl);
  card.append(arrow, visual, body);

  let activeTrigger = null;
  let showTimer = 0;
  let hideTimer = 0;
  let hoveringCard = false;
  let escapeHandledAt = 0;

  const isOpen = () => (supportsPopover ? card.matches(':popover-open') : !card.hidden);
  const ensureHost = () => {
    const host = root.closest('dialog') || document.body;
    if (card.parentElement !== host) host.append(card);
  };

  function positionCard(trigger) {
    const rect = trigger.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const gap = 10;
    const width = cardRect.width || 248;
    const height = cardRect.height || 205;
    const placeTop = rect.top >= height + gap + 8 || window.innerHeight - rect.bottom < height + gap;
    const top = placeTop ? Math.max(8, rect.top - height - gap) : Math.min(window.innerHeight - height - 8, rect.bottom + gap);
    const center = rect.left + rect.width / 2;
    const left = Math.max(10, Math.min(window.innerWidth - width - 10, center - width / 2));
    card.dataset.placement = placeTop ? 'top' : 'bottom';
    card.style.top = `${Math.round(top)}px`;
    card.style.left = `${Math.round(left)}px`;
    card.style.setProperty('--arrow-x', `${Math.round(Math.max(18, Math.min(width - 18, center - left)))}px`);
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (activeTrigger) {
      activeTrigger.removeAttribute('aria-describedby');
      activeTrigger = null;
    }
    if (supportsPopover) {
      if (isOpen()) card.hidePopover();
    } else {
      card.hidden = true;
      card.classList.remove('is-open');
    }
  }

  function show(trigger, opt) {
    clearTimeout(hideTimer);
    if (activeTrigger && activeTrigger !== trigger) {
      activeTrigger.removeAttribute('aria-describedby');
    }
    activeTrigger = trigger;
    trigger.setAttribute('aria-describedby', cardId);

    visual.replaceChildren();
    if (opt.preview_image) {
      const img = el('img');
      img.src = opt.preview_image;
      img.alt = '';
      visual.append(img);
    } else {
      visual.append(renderColorSvg(COLOR_SWATCHES[opt.preview_key]));
    }
    titleEl.textContent = opt.phrase;
    descEl.textContent = opt.effect || '';

    ensureHost();
    if (supportsPopover) {
      if (!isOpen()) card.showPopover();
    } else {
      card.hidden = false;
      card.classList.add('is-open');
    }
    positionCard(trigger);
  }

  function scheduleShow(trigger, opt, immediate = false) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (immediate || isOpen()) {
      show(trigger, opt);
    } else {
      showTimer = setTimeout(() => show(trigger, opt), 110);
    }
  }

  function scheduleHide(trigger) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!hoveringCard && activeTrigger === trigger) hide();
    }, 120);
  }

  card.addEventListener('mouseenter', () => {
    hoveringCard = true;
    clearTimeout(hideTimer);
  });
  card.addEventListener('mouseleave', () => {
    hoveringCard = false;
    scheduleHide(activeTrigger);
  });

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && isOpen()) {
      escapeHandledAt = Date.now();
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  };
  const onCancel = (e) => {
    if (isOpen() || Date.now() - escapeHandledAt < 300) {
      e.preventDefault();
      e.stopPropagation();
      hide();
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('cancel', onCancel, true);

  groups.forEach((group) => {
    const target = group.target || 'visual';
    const row = el('div', undefined, 'creation-phrase-row');
    row.append(el('span', group.title, 'creation-phrase-group'));
    const chips = el('div', undefined, 'creation-chips');
    const options =
      group.options?.length
        ? group.options
        : (group.phrases || []).map((phrase) => ({ phrase }));

    options.forEach((opt) => {
      const chip = el('button', `+ ${opt.phrase}`, 'creation-chip');
      chip.type = 'button';
      if (hasPreview(opt)) {
        chip.addEventListener('mouseenter', () => scheduleShow(chip, opt, false));
        chip.addEventListener('mouseleave', () => scheduleHide(chip));
        chip.addEventListener('focus', () => scheduleShow(chip, opt, true));
        chip.addEventListener('blur', () => scheduleHide(chip));
      } else {
        chip.addEventListener('mouseenter', () => hide());
      }
      chip.addEventListener('click', () => {
        hide();
        onPick(target, opt.phrase);
      });
      chips.append(chip);
    });
    row.append(chips);
    root.append(row);
  });

  return {
    element: root,
    hide,
    destroy() {
      hide();
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('cancel', onCancel, true);
      card.remove();
    },
  };
}
