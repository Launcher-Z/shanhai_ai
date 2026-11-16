/* 9.3分步工作台（3步）：继承定基 → 改词润色 → 定稿赴绘。 */
import { api, el, field, button, copy, appendPhrase, renderStepNav, buildStepFooter } from './common.js';
import { store } from './storage.js';
import { createPhrasePicker } from './phrase-picker.js';

const STEPS = [
  ['壹', '继承定基'],
  ['贰', '改词润色'],
  ['叁', '定稿赴绘'],
];

const EVAL_LABELS = [
  ['feature_keep', '特征保留'],
  ['magical_detail', '神异细节'],
  ['visual_harmony', '画面协调'],
];

const OPTIMIZE_INSTRUCTION =
  '请在保留我的动物特点和神异设定的前提下，让下面的文生图提示词更清楚。不要擅自增加器官或改变创作意图。给出建议稿，并简要说明改动：\n';

function parseJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

export function createPolishStudio({
  canvas,
  state,
  write,
  studentId,
  animals = [],
  library,
  config,
  message,
  promptText,
  onOptimizeInternal,
  onGenerateInternal,
  onMountPreview,
}) {
  const studio = el('section', undefined, 'creation-studio');
  const nav = el('nav', undefined, 'creation-steps');
  nav.dataset.steps = String(STEPS.length);
  nav.setAttribute('aria-label', '创作步骤');
  const body = el('div', undefined, 'creation-studio-body');
  const candidateSlot = el('div', undefined, 'creation-candidate-slot');
  studio.append(nav, body);
  canvas.append(studio);

  if (typeof state.step !== 'number' || state.step < 0 || state.step >= STEPS.length) {
    state.step = 0;
  }

  let destroyed = false;
  let activePicker = null;
  let heritageLoading = true;
  let heritageError = '';
  let heritage = buildHeritage(null);

  function readLocalDraft() {
    if (!studentId) return null;
    try {
      const local = store(studentId, 'lesson-9-task-1').read();
      return local && Object.keys(local).length ? local : null;
    } catch {
      return null;
    }
  }

  function buildHeritage(record) {
    const local = readLocalDraft();
    const answers = record?.answers || {};
    const upload = parseJson(answers['draft-upload']) || parseJson(answers['draft-work']) || {};
    const rating = parseJson(answers['draft-evaluation']) || {};
    const work = upload.works?.[0] || null;
    const animalId = upload.animal_id || local?.animal_id || '';
    const animalObj = animals.find((a) => a.id === animalId) || null;
    const animalName =
      upload.animal_name || rating.animal_name || local?.animal_name || animalObj?.name || '';
    const prompt = work?.prompt || local?.prompt || state.draft_prompt || '';
    const mediaId = work?.media_id || '';
    const title = work?.title || state.draft_title || '';
    const evaluation = rating.evaluation || null;
    const choices = [
      ['动物原型', animalName],
      ['保留特征', local?.animal],
      ['神异能力', local?.spirit],
      ['可见细节', local?.detail],
      ['姿态环境', local?.scene],
      ['画面表现', local?.visual],
    ].filter(([, val]) => Boolean(val && String(val).trim()));

    return {
      hasAny: Boolean(mediaId || prompt || choices.length || evaluation),
      mediaId,
      title,
      animalName,
      animalImage: animalObj?.image || '',
      prompt,
      choices,
      evaluation,
      aiOptimization: work?.ai_optimization || null,
    };
  }

  function syncDraftIntoState() {
    if (!heritage.prompt) return false;
    let changed = false;
    if (state.draft_prompt !== heritage.prompt) {
      state.draft_prompt = heritage.prompt;
      changed = true;
    }
    if (heritage.animalName && state.animal_name !== heritage.animalName) {
      state.animal_name = heritage.animalName;
      changed = true;
    }
    if (heritage.title && state.draft_title !== heritage.title) {
      state.draft_title = heritage.title;
      changed = true;
    }
    if (!state.prompt?.trim()) {
      state.prompt = heritage.prompt;
      changed = true;
      if (heritage.aiOptimization?.used && !state.ai_used) {
        state.ai_used = true;
        state.optimization_original = heritage.aiOptimization.original_prompt || '';
        state.suggestion = heritage.aiOptimization.suggested_prompt || '';
        state.optimization_mode = heritage.aiOptimization.mode || 'external';
      }
    }
    if (changed) write();
    return changed;
  }

  async function loadHeritage() {
    try {
      const record = await api('/api/worksheets/lesson-9-task-1');
      if (destroyed) return;
      heritage = buildHeritage(record);
      heritageError = '';
      syncDraftIntoState();
    } catch (e) {
      if (destroyed) return;
      heritage = buildHeritage(null);
      heritageError = e.message || '';
      syncDraftIntoState();
    } finally {
      if (destroyed) return;
      heritageLoading = false;
      renderNav();
      if (state.step === 0) {
        render();
      } else {
        const promptInput = body.querySelector('[aria-label="我的提示词（修改稿）"], [aria-label="我的提示词"]');
        if (promptInput && !promptInput.value.trim() && state.prompt) {
          promptInput.value = state.prompt;
        }
      }
    }
  }

  function goStep(index) {
    state.step = index;
    write();
    render();
  }

  function renderNav() {
    renderStepNav(
      nav,
      STEPS,
      state.step,
      [
        Boolean(heritage.hasAny || state.draft_prompt || state.focus_goal),
        Boolean(state.prompt?.trim()),
        Boolean(state.prompt?.trim() && state.step === 2),
      ],
      goStep,
    );
  }

  function restoreDraftPrompt(promptInput) {
    if (!heritage.prompt) return;
    state.prompt = heritage.prompt;
    state.draft_prompt = heritage.prompt;
    if (promptInput) promptInput.value = state.prompt;
    write();
    message.textContent = '已恢复为 9.1 初稿提示词，可重新修改。';
    if (state.step === 0) render();
  }

  function renderHeritageStep() {
    if (heritageLoading) {
      body.append(el('p', '正在读取你在 9.1 的初稿图文、选择与自评记录…', 'creation-heritage-loading'));
    } else if (!heritage.hasAny) {
      const empty = el('div', undefined, 'creation-heritage-empty');
      empty.append(
        el('strong', '暂未检测到 9.1 的初稿记录'),
        el(
          'p',
          heritageError
            ? `读取 9.1 记录时遇到问题（${heritageError}），你仍可直接点击下一步撰写本次提示词。`
            : '可以先回到「9.1 赋予动物灵气 · 初创」完成一次生图与记录；也可以直接点击下一步重新起草。',
        ),
      );
      body.append(empty);
    } else {
      const card = el('article', undefined, 'creation-heritage-card');
      const head = el('div', undefined, 'creation-heritage-head');
      const titleWrap = el('div', undefined, 'creation-heritage-title');
      titleWrap.append(el('h4', '9.1 初稿档案'));
      if (heritage.title) titleWrap.append(el('span', `《${heritage.title}》`, 'creation-heritage-workname'));
      head.append(titleWrap);

      const statusWrap = el('div', undefined, 'creation-heritage-actions');
      if (heritage.prompt) {
        const modified = Boolean(state.prompt?.trim() && state.prompt.trim() !== heritage.prompt.trim());
        statusWrap.append(
          el(
            'span',
            modified ? '已基于初稿修改' : '已自动带入修改底稿',
            `creation-heritage-badge${modified ? ' is-modified' : ''}`,
          ),
        );
        if (modified) {
          const resetBtn = button('恢复初稿词', () => restoreDraftPrompt());
          resetBtn.classList.add('creation-heritage-reset');
          statusWrap.append(resetBtn);
        }
      }
      head.append(statusWrap);
      card.append(head);

      const layout = el('div', undefined, 'creation-heritage-layout');
      if (heritage.mediaId || heritage.animalImage) {
        const mediaCol = el('div', undefined, 'creation-heritage-media');
        if (heritage.mediaId) {
          const link = el('a', undefined, 'creation-heritage-thumb');
          link.href = `/api/creation/media/${heritage.mediaId}`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.title = '点击查看 9.1 初稿大图';
          const img = el('img');
          img.src = `/api/creation/media/${heritage.mediaId}/thumbnail`;
          img.alt = heritage.title || '9.1 初稿作品';
          link.append(img);
          mediaCol.append(link, el('small', '点击可查看初稿大图'));
        } else {
          const fig = el('div', undefined, 'creation-heritage-thumb is-reference');
          const img = el('img');
          img.src = heritage.animalImage;
          img.alt = heritage.animalName || '参考动物';
          fig.append(img);
          mediaCol.append(fig, el('small', '原型参考（9.1 暂未传作品图）'));
        }
        layout.append(mediaCol);
      }

      const infoCol = el('div', undefined, 'creation-heritage-info');
      if (heritage.choices.length) {
        const choiceBlock = el('div', undefined, 'creation-heritage-section');
        choiceBlock.append(el('span', '之前的设定与选择', 'creation-heritage-label'));
        const list = el('div', undefined, 'creation-heritage-choices');
        heritage.choices.forEach(([label, value]) => {
          const item = el('div', undefined, 'creation-heritage-choice');
          item.append(el('em', label), el('span', value));
          list.append(item);
        });
        choiceBlock.append(list);
        infoCol.append(choiceBlock);
      }

      if (heritage.prompt) {
        const promptBlock = el('div', undefined, 'creation-heritage-section');
        promptBlock.append(
          el('span', '9.1 初稿提示词', 'creation-heritage-label'),
          el('blockquote', heritage.prompt, 'creation-heritage-prompt'),
        );
        infoCol.append(promptBlock);
      }

      if (heritage.evaluation) {
        const evalBlock = el('div', undefined, 'creation-heritage-section');
        evalBlock.append(el('span', '9.1 初稿自评', 'creation-heritage-label'));
        const scores = el('div', undefined, 'creation-heritage-scores');
        let hasScore = false;
        EVAL_LABELS.forEach(([key, label]) => {
          const val = heritage.evaluation[key];
          if (typeof val === 'number') {
            hasScore = true;
            scores.append(el('span', `${label} ${val}/5`, 'creation-score-pill'));
          }
        });
        if (hasScore) evalBlock.append(scores);
        if (heritage.evaluation.detail?.trim()) {
          evalBlock.append(el('p', `自评与改进想法：${heritage.evaluation.detail}`, 'creation-heritage-eval-note'));
        }
        if (hasScore || heritage.evaluation.detail?.trim()) infoCol.append(evalBlock);
      }

      layout.append(infoCol);
      card.append(layout);
      body.append(card);
    }

    const goal = field(body, '本次修改焦点（选填，方便润色时对照）', state.focus_goal, (v) => {
      state.focus_goal = v;
      write();
    });
    goal.rows = 2;
    goal.placeholder = '例如：把尾尖微光写得更具体，补充月夜石阶与水墨画风';
    body.append(buildStepFooter(null, 1, '下一步：改词润色 →', goStep));
  }

  function renderPolishStep() {
    if (state.focus_goal?.trim() || state.draft_prompt?.trim()) {
      const bar = el('div', undefined, 'creation-mini-badge');
      const barText = el('div', undefined, 'creation-mini-text');
      if (state.focus_goal?.trim()) {
        barText.append(el('strong', `修改焦点：${state.focus_goal.trim()}`));
      } else {
        barText.append(el('strong', '对照 9.1 初稿'));
      }
      if (state.draft_prompt?.trim()) {
        barText.append(el('span', ` · 初稿：${state.draft_prompt.trim()}`));
      }
      bar.append(barText);
      body.append(bar);
    }

    const promptInput = field(body, '我的提示词（修改稿）', state.prompt, (v) => {
      state.prompt = v;
      write();
    });
    promptInput.rows = 3;
    promptInput.placeholder = '直接在初稿提示词上增删改写；也可点选下方词条或使用文心一言优化';

    activePicker = createPhrasePicker({
      library,
      onPick(_target, phrase) {
        state.prompt = appendPhrase(state.prompt, phrase);
        promptInput.value = state.prompt;
        write();
      },
    });
    if (activePicker.element.childElementCount) body.append(activePicker.element);

    const aiBox = el('section', undefined, 'creation-polish-ai');
    const aiHead = el('div', undefined, 'creation-polish-ai-head');
    aiHead.append(el('strong', '可选'), el('span', '文心一言润色（直接对上面这份提示词提建议；用过建议需在札记填 1 条反思）'));
    aiBox.append(aiHead);

    const optActions = el('div', undefined, 'creation-actions');
    optActions.append(
      button('复制优化请求', () => {
        const base = (state.prompt || '').trim();
        if (!base) throw new Error('请先在上方填写需要优化的提示词。');
        state.optimization_original = base;
        write();
        return copy(OPTIMIZE_INSTRUCTION + base);
      }),
    );
    const launchOpt = el('a', '前往文心一言优化 ↗', 'creation-link creation-launch');
    launchOpt.href = config.optimize.external_url;
    launchOpt.target = '_blank';
    launchOpt.rel = 'noopener noreferrer';
    optActions.append(launchOpt);

    let suggestionInput;
    if (config.optimize.mode === 'internal') {
      optActions.append(
        button('在这里请求优化建议', () => {
          const base = (state.prompt || '').trim();
          if (!base) throw new Error('请先在上方填写需要优化的提示词。');
          return onOptimizeInternal(aiBox, base, (text) => {
            if (suggestionInput) suggestionInput.value = text;
          });
        }),
      );
    }
    aiBox.append(optActions);
    if (state.ai_result) aiBox.append(el('p', state.ai_result, 'creation-ai-result'));

    suggestionInput = field(aiBox, '粘贴 AI 优化建议（本机草稿）', state.suggestion, (v) => {
      state.suggestion = v;
      state.ai_used = Boolean(v.trim());
      if (state.ai_used) {
        state.optimization_mode ||= 'external';
        state.optimization_original ||= (state.prompt || state.draft_prompt || '').trim();
      }
      write();
    });
    suggestionInput.rows = 2;
    suggestionInput.placeholder = '得到文心一言建议后粘贴到这里；可一键采纳，也可只挑其中的好词句手动修改上方提示词';

    aiBox.append(
      button('采纳建议替换上方提示词', () => {
        const next = (state.suggestion || '').trim();
        if (!next) throw new Error('请先粘贴文心一言给出的建议稿。');
        state.optimization_original ||= (state.prompt || state.draft_prompt || '').trim();
        state.prompt = next;
        state.ai_used = true;
        promptInput.value = next;
        write();
        message.textContent = '已用 AI 建议更新提示词，你还可以继续手动微调。';
      }),
    );
    body.append(aiBox);
    body.append(buildStepFooter(0, 2, '下一步：定稿赴绘 →', goStep));
  }

  function renderFinalStep() {
    const recap = el('div', undefined, 'creation-recap creation-recap--2');
    const draftSummary = state.draft_prompt?.trim()
      ? state.draft_prompt.trim()
      : '未带入 9.1 初稿（可直接微调下方提示词）';
    const polishSummary = [
      state.ai_used ? '已结合 AI 优化' : '自主润色修改',
      state.focus_goal?.trim() ? `焦点：${state.focus_goal.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    [
      ['壹 初稿底稿', draftSummary, 0],
      ['贰 本次润色', polishSummary, 1],
    ].forEach(([tag, val, targetStep]) => {
      const item = el('button', undefined, 'creation-recap-chip');
      item.type = 'button';
      item.append(el('strong', tag), el('span', val));
      item.addEventListener('click', () => goStep(targetStep));
      recap.append(item);
    });
    body.append(recap);

    const promptInput = field(body, '我的提示词', state.prompt, (v) => {
      state.prompt = v;
      write();
    });
    promptInput.rows = 3;
    promptInput.placeholder = '请先在上一步改写或填写最终生图提示词';

    const actions = el('div', undefined, 'creation-actions');
    actions.append(
      button('复制生图提示词', () => {
        if (!promptText()) throw new Error('请先填写或修改提示词。');
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
      el(
        'p',
        '在文心一言生成并保存满意的作品后，打开右上角“学习札记”上传图片、保存提示词（用过 AI 优化需填 1 条轻量使用反思）。',
      ),
      buildStepFooter(1, null, '', goStep),
    );
  }

  function render() {
    activePicker?.destroy();
    activePicker = null;
    renderNav();
    body.replaceChildren();
    if (state.step === 0) renderHeritageStep();
    else if (state.step === 1) renderPolishStep();
    else renderFinalStep();
  }

  render();
  loadHeritage();

  return {
    previewHost: () => (candidateSlot.isConnected ? candidateSlot : canvas),
    destroy() {
      destroyed = true;
      activePicker?.destroy();
      activePicker = null;
    },
  };
}
