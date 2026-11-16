/* 9.1分步工作台：选定动物原型 → 赋予可见神异细节 → 造境与画风 → 成词赴绘。 */
import { el, field, button, copy, appendPhrase, renderStepNav, buildStepFooter } from './common.js';
import { createPhrasePicker } from './phrase-picker.js';

const STEPS = [
  ['壹', '选动物原型'],
  ['贰', '赋神异细节'],
  ['叁', '造境与画风'],
  ['肆', '成词赴绘'],
];

export function createDraftStudio({
  canvas,
  state,
  write,
  animals,
  library,
  config,
  promptText,
  onGenerateInternal,
  onMountPreview,
}) {
  const studio = el('section', undefined, 'creation-studio');
  const nav = el('nav', undefined, 'creation-steps');
  nav.setAttribute('aria-label', '创作步骤');
  const body = el('div', undefined, 'creation-studio-body');
  const candidateSlot = el('div', undefined, 'creation-candidate-slot');
  studio.append(nav, body);
  canvas.append(studio);

  if (typeof state.step !== 'number' || state.step < 0 || state.step >= STEPS.length) {
    state.step = 0;
  }

  const activeAnimal = () => animals.find((a) => a.id === state.animal_id) || null;
  const animalLabel = () => {
    if (state.animal_id === 'custom') return (state.animal_name || '').trim();
    return activeAnimal()?.name || (state.animal_name || '').trim();
  };

  function composePrompt() {
    const name = animalLabel();
    const firstPart =
      name && !(state.animal || '').includes(name)
        ? [name, state.animal].filter(Boolean).join('，')
        : state.animal;
    return [firstPart, state.spirit, state.detail, state.scene, state.visual].filter(Boolean).join('，');
  }

  function renderNav() {
    renderStepNav(
      nav,
      STEPS,
      state.step,
      [
        Boolean(animalLabel() || state.animal),
        Boolean(state.spirit || state.detail),
        Boolean(state.scene || state.visual),
        Boolean(state.prompt),
      ],
      (index) => {
        state.step = index;
        write();
        render();
      },
    );
  }

  function renderAnimalFocus(host) {
    const focus = el('div', undefined, 'creation-animal-focus');
    const chosen = activeAnimal();
    if (chosen) {
      const thumb = el('img');
      thumb.src = chosen.image;
      thumb.alt = chosen.name;
      const meta = el('div', undefined, 'creation-animal-meta');
      meta.append(el('h4', chosen.name));
      const chips = el('div', undefined, 'creation-chips');
      chosen.features.forEach((feat) => {
        const chip = el('button', `+ ${feat}`, 'creation-chip');
        chip.type = 'button';
        chip.addEventListener('click', () => {
          state.animal = appendPhrase(state.animal, feat);
          write();
          const input = body.querySelector('[aria-label="喜欢的动物与保留特征"]');
          if (input) input.value = state.animal;
        });
        chips.append(chip);
      });
      meta.append(chips, el('p', `灵感：${chosen.hint}`, 'creation-animal-hint'));
      focus.append(thumb, meta);
    } else if (state.animal_id === 'custom') {
      const nameInput = field(focus, '自选动物名称', state.animal_name, (v) => {
        state.animal_name = v;
        write();
      });
      nameInput.rows = 1;
      nameInput.placeholder = '例如：猫头鹰、小刺猬、乌龟';
    } else {
      focus.append(el('p', '点选上方动物卡片，参考它的真实外形特点。', 'creation-animal-hint'));
    }
    host.append(focus);
  }

  function stepFooter(prevIndex, nextIndex, nextLabel) {
    return buildStepFooter(prevIndex, nextIndex, nextLabel, (index) => {
      state.step = index;
      if (index === 3 && !state.prompt?.trim()) {
        const composed = composePrompt();
        if (composed) state.prompt = composed;
      }
      write();
      render();
    });
  }

  let activePicker = null;

  function render() {
    activePicker?.destroy();
    activePicker = null;
    renderNav();
    body.replaceChildren();
    if (state.step === 0) {
      const grid = el('div', undefined, 'creation-animal-grid');
      animals.forEach((animal) => {
        const card = el('button', undefined, 'creation-animal-card');
        card.type = 'button';
        card.setAttribute('aria-pressed', String(state.animal_id === animal.id));
        const img = el('img');
        img.src = animal.image;
        img.alt = '';
        img.loading = 'lazy';
        card.append(img, el('span', animal.name, 'creation-animal-name'));
        card.addEventListener('click', () => {
          state.animal_id = animal.id;
          state.animal_name = animal.name;
          write();
          render();
        });
        grid.append(card);
      });
      const custom = el('button', undefined, 'creation-animal-card is-custom');
      custom.type = 'button';
      custom.setAttribute('aria-pressed', String(state.animal_id === 'custom'));
      custom.append(el('span', '＋', 'creation-custom-mark'), el('span', '自选动物', 'creation-animal-name'));
      custom.addEventListener('click', () => {
        state.animal_id = 'custom';
        if (animals.some((a) => a.name === state.animal_name)) state.animal_name = '';
        write();
        render();
      });
      grid.append(custom);
      body.append(grid);
      renderAnimalFocus(body);
      const keep = field(body, '喜欢的动物与保留特征', state.animal, (v) => {
        state.animal = v;
        write();
      });
      keep.rows = 2;
      keep.placeholder = '可点击上方特征标签填入，或自己补充想保留的样子';
      body.append(stepFooter(null, 1, '下一步：赋神异细节 →'));
      return;
    }

    if (state.step === 1) {
      const chosen = activeAnimal();
      const summary = el('div', undefined, 'creation-mini-badge');
      if (chosen) {
        const img = el('img');
        img.src = chosen.image;
        img.alt = chosen.name;
        summary.append(img);
      }
      const label = animalLabel() || '未选定动物';
      summary.append(
        el('div', undefined, 'creation-mini-text'),
      );
      summary.lastChild.append(
        el('strong', label),
        el('span', state.animal ? ` · ${state.animal}` : ''),
      );
      body.append(summary);

      const spirit = field(body, '赋予的神异能力或寓意', state.spirit, (v) => {
        state.spirit = v;
        write();
      });
      spirit.rows = 2;
      spirit.placeholder = '例如：为夜间迷路的人引路';
      const detail = field(body, '怎样变成画面里可见的细节', state.detail, (v) => {
        state.detail = v;
        write();
      });
      detail.rows = 2;
      detail.placeholder = '把能力翻译成能画出来的形状、动作或光色（如：尾尖散发暖黄微光）';
      if (chosen?.hint) {
        body.append(el('p', `写法参考：${chosen.hint}`, 'creation-animal-hint'));
      }
      body.append(stepFooter(0, 2, '下一步：造境与画风 →'));
      return;
    }

    if (state.step === 2) {
      const scene = field(body, '姿态与环境', state.scene, (v) => {
        state.scene = v;
        write();
      });
      scene.rows = 2;
      scene.placeholder = '例如：蹲在青苔石阶上回望，身后是月夜松林';
      const visual = field(body, '画面表现（风格、构图、光色，按需选）', state.visual, (v) => {
        state.visual = v;
        write();
      });
      visual.rows = 2;
      visual.placeholder = '点选下方短语，悬停可预览效果，或自行补充';

      activePicker = createPhrasePicker({
        library,
        onPick(target, phrase) {
          if (target === 'scene') {
            state.scene = appendPhrase(state.scene, phrase);
            scene.value = state.scene;
          } else {
            state.visual = appendPhrase(state.visual, phrase);
            visual.value = state.visual;
          }
          write();
        },
      });
      if (activePicker.element.childElementCount) body.append(activePicker.element);
      body.append(stepFooter(1, 3, '下一步：成词赴绘 →'));
      return;
    }

    const recap = el('div', undefined, 'creation-recap');
    [
      ['壹 原型', [animalLabel(), state.animal].filter(Boolean).join(' · '), 0],
      ['贰 灵气', [state.spirit, state.detail].filter(Boolean).join(' · '), 1],
      ['叁 画面', [state.scene, state.visual].filter(Boolean).join(' · '), 2],
    ].forEach(([tag, val, targetStep]) => {
      const item = el('button', undefined, 'creation-recap-chip');
      item.type = 'button';
      item.append(el('strong', tag), el('span', val || '未填'));
      item.addEventListener('click', () => {
        state.step = targetStep;
        write();
        render();
      });
      recap.append(item);
    });
    body.append(recap);

    let promptInput;
    body.append(
      button('将这些想法组织成提示词', () => {
        state.prompt = composePrompt();
        if (promptInput) promptInput.value = state.prompt;
        write();
      }),
    );
    promptInput = field(body, '我的提示词', state.prompt, (v) => {
      state.prompt = v;
      write();
    });
    promptInput.rows = 3;

    const actions = el('div', undefined, 'creation-actions');
    actions.append(
      button('复制生图提示词', () => {
        if (!promptText()) throw new Error('请先填写或组织提示词。');
        return copy(promptText());
      }),
    );
    const launch = el('a', '前往文心一言绘图 ↗', 'creation-link creation-launch');
    launch.href = config.generate.external_url;
    launch.target = '_blank';
    launch.rel = 'noopener noreferrer';
    actions.append(launch);
    if (config.generate.mode === 'internal') {
      actions.append(button('在这里生成一张图', () => onGenerateInternal(body)));
    }
    body.append(actions);

    if (config.generate.mode === 'internal') {
      body.append(candidateSlot);
      onMountPreview(candidateSlot);
    }
    body.append(
      el('p', '在文心一言生成并保存喜欢的图片后，打开右上角“学习札记”在第 1 部分上传图片与提示词，提交后再在第 2 部分自评。'),
      stepFooter(2, null, ''),
    );
  }

  render();
  return {
    previewHost: () => (candidateSlot.isConnected ? candidateSlot : canvas),
    animalInfo: () => ({ id: state.animal_id || '', name: animalLabel() }),
    destroy() {
      activePicker?.destroy();
      activePicker = null;
    },
  };
}
