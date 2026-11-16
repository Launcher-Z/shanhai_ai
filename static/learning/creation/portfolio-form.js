/* 9.3两段札记：第一段子标签切换管理1—3份定稿图文；第二段回看图文并完成AI或自主反思。 */
import {
  el,
  field,
  blankWork,
  button,
  uploadCreationMedia,
  matches,
  pictureLink,
  createNoteBlock,
  createLabeledTextarea,
} from './common.js';

export function createPortfolioForm(q, input, activityId, controller, getAnswers) {
  const root = el('div', undefined, 'creation-form original-form is-draft-form is-portfolio-form');
  let state;
  try {
    state = JSON.parse(input.value);
  } catch {
    state = { schema_version: 1 };
  }
  const update = () => {
    input.value = JSON.stringify(state);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  function createWorkFromDraft() {
    const w = blankWork();
    const draft = controller?.draft?.();
    if (draft) {
      w.prompt = draft.prompt || '';
      w.ai_optimization = draft.ai_optimization || { used: false };
      w.tool = draft.tool || w.tool;
    }
    if (!w.tool.name) w.tool.name = '文心一言';
    if (!w.tool.mode) w.tool.mode = 'external';
    if (w.ai_optimization && !w.ai_optimization.tool_name) w.ai_optimization.tool_name = '文心一言';
    return w;
  }

  let initializedDefaultWork = false;
  let activeIndex = 0;

  function renderUpload() {
    state.works ||= [];
    if (!initializedDefaultWork) {
      initializedDefaultWork = true;
      if (!state.works.length) {
        state.works.push(createWorkFromDraft());
        input.value = JSON.stringify(state);
      }
    }
    if (activeIndex >= state.works.length) activeIndex = Math.max(0, state.works.length - 1);

    const latestDraft = controller?.draft?.();

    // 子标签切换栏：使用 <a> 标签作为 tab，即使提交后 fieldset disabled 仍可切换回看各份作品。
    const tabBar = el('div', undefined, 'creation-work-tabs');
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', '定稿作品列表');

    state.works.forEach((w, idx) => {
      const tab = el('a', undefined, `creation-work-tab${idx === activeIndex ? ' is-active' : ''}${w.media_id ? ' has-media' : ''}`);
      tab.href = `#portfolio-work-${idx + 1}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(idx === activeIndex));
      tab.append(el('span', `作品 ${idx + 1}`));
      if (w.media_id) {
        const dot = el('i', undefined, 'creation-work-tab-dot');
        dot.title = '已上传图片';
        tab.append(dot);
      }
      tab.addEventListener('click', (e) => {
        e.preventDefault();
        if (root.dataset.uploading || activeIndex === idx) return;
        activeIndex = idx;
        render();
      });
      tabBar.append(tab);
    });

    if (state.works.length < 3) {
      const addBtn = button('+ 添加作品', () => {
        if (root.dataset.uploading) return;
        state.works.push(createWorkFromDraft());
        activeIndex = state.works.length - 1;
        update();
        render();
      });
      addBtn.classList.add('creation-note-inline-btn', 'creation-work-add');
      tabBar.append(addBtn);
    }
    root.append(tabBar);

    if (!state.works.length) {
      const empty = el('div', undefined, 'creation-note-block is-media');
      empty.append(el('p', '当前没有作品，点击上方“+ 添加作品”开始整理（最多 3 份）。', 'creation-empty-hint'));
      root.append(empty);
      return;
    }

    const work = state.works[activeIndex];
    if (!work.tool) work.tool = { mode: 'external', name: '文心一言', model: '' };
    if (!work.tool.name) work.tool.name = latestDraft?.tool?.name || '文心一言';
    if (!work.tool.mode) work.tool.mode = latestDraft?.tool?.mode || 'external';
    if (!work.ai_optimization) {
      work.ai_optimization = {
        used: false,
        mode: 'external',
        tool_name: '文心一言',
        original_prompt: '',
        suggested_prompt: '',
      };
    }

    // 块 1：定稿画面
    const mediaBlock = createNoteBlock(
      `作品 ${activeIndex + 1} · 定稿画面`,
      'is-media',
      work.media_id ? '已上传' : '待上传',
    );
    const removeBtn = button('移除这份作品', () => {
      if (root.dataset.uploading) return;
      state.works.splice(activeIndex, 1);
      if (activeIndex >= state.works.length) activeIndex = Math.max(0, state.works.length - 1);
      update();
      render();
    });
    removeBtn.classList.add('creation-note-inline-btn', 'is-danger-subtle');
    mediaBlock.head.append(removeBtn);

    const file = el('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp';
    const fileLabel = el('label', '上传作品图片（自动压缩并随札记保存）', 'creation-upload-label');
    fileLabel.append(file);

    let errorNode;
    function showError(msg) {
      if (!errorNode) {
        errorNode = el('p', msg, 'creation-error');
        mediaBlock.block.append(errorNode);
      } else {
        errorNode.textContent = msg;
      }
    }

    async function upload(blob) {
      if (root.dataset.uploading) return;
      if (blob.size > 12 * 1024 * 1024) {
        showError('请选择12MB以内的图片。');
        return;
      }
      root.dataset.uploading = 'true';
      file.disabled = true;
      try {
        const result = await uploadCreationMedia(blob, activityId);
        work.media_id = result.media_id;
        const currentDraft = controller?.draft?.();
        if (currentDraft) {
          if (!work.prompt && currentDraft.prompt) work.prompt = currentDraft.prompt;
          if (!work.tool.name && currentDraft.tool?.name) work.tool.name = currentDraft.tool.name;
          if (currentDraft.tool?.mode) work.tool.mode = currentDraft.tool.mode;
          if (!work.ai_optimization?.used && currentDraft.ai_optimization?.used) {
            work.ai_optimization = currentDraft.ai_optimization;
          }
        }
        update();
        render();
      } catch (e) {
        showError(e.message);
      } finally {
        file.disabled = false;
        delete root.dataset.uploading;
      }
    }

    file.addEventListener('change', () => {
      if (file.files[0]) upload(file.files[0]);
    });

    if (work.media_id) {
      const previewRow = el('div', undefined, 'creation-upload-preview-row');
      const image = el('img', undefined, 'original-upload-preview');
      image.src = `/api/creation/media/${work.media_id}/thumbnail`;
      image.alt = work.title || `作品 ${activeIndex + 1}`;
      const thumbLink = pictureLink(image, 'creation-upload-thumb');
      thumbLink.href = `/api/creation/media/${work.media_id}`;
      const side = el('div', undefined, 'creation-upload-side');
      side.append(fileLabel, el('small', '支持 PNG / JPEG / WebP，点击左侧图片可查看大图。'));
      previewRow.append(thumbLink, side);
      mediaBlock.block.append(previewRow);
    } else {
      const drop = el('div', undefined, 'creation-upload-drop');
      drop.append(fileLabel, el('small', '支持 PNG / JPEG / WebP（12MB 以内）'));
      mediaBlock.block.append(drop);
    }
    root.append(mediaBlock.block);

    // 块 2：作品信息（双列紧凑排列）
    const metaBlock = createNoteBlock('作品信息', 'is-meta');
    const metaRow = el('div', undefined, 'creation-note-row creation-note-row--2');
    const titleInput = field(metaRow, '作品名', work.title, (v) => {
      work.title = v;
      update();
    });
    titleInput.rows = 1;
    titleInput.placeholder = '给作品起个名字';

    const toolInput = field(metaRow, '生图应用名称', work.tool.name, (v) => {
      work.tool.name = v;
      update();
    });
    toolInput.rows = 1;
    metaBlock.block.append(metaRow);
    root.append(metaBlock.block);

    // 块 3：实际生成提示词
    const promptBlock = createNoteBlock('', 'is-prompt');
    promptBlock.titleNode.remove();
    const promptInput = createLabeledTextarea(
      promptBlock.head,
      '实际生成这张图的完整提示词',
      `${q.id}-prompt-${activeIndex}`,
      work.prompt,
      (v) => {
        work.prompt = v;
        update();
      },
      3,
    );
    if (latestDraft?.prompt && latestDraft.prompt !== work.prompt) {
      const syncBtn = button('同步活动中的提示词', () => {
        work.prompt = latestDraft.prompt;
        promptInput.value = latestDraft.prompt;
        if (latestDraft.ai_optimization?.used && !work.ai_optimization?.used) {
          work.ai_optimization = latestDraft.ai_optimization;
          update();
          render();
          return;
        }
        update();
      });
      syncBtn.classList.add('creation-note-inline-btn');
      promptBlock.head.append(syncBtn);
    }
    promptBlock.block.append(promptInput);
    root.append(promptBlock.block);

    // 块 4：AI 优化记录
    const ai = work.ai_optimization;
    const aiBlock = createNoteBlock('提示词优化来源', 'is-ai-opt', ai.used ? '已用 AI 优化' : '自主编写');
    field(
      aiBlock.block,
      '是否用过AI优化提示词（舍弃建议也选“用过”）',
      ai.used ? 'yes' : 'no',
      (v) => {
        ai.used = v === 'yes';
        update();
        render();
      },
      [
        ['no', '没有，仅自己编写'],
        ['yes', '用过AI优化建议'],
      ],
    );
    if (ai.used) {
      const hasBoth = Boolean(ai.original_prompt?.trim() && ai.suggested_prompt?.trim());
      const details = el('details', undefined, 'creation-opt-details');
      details.open = !hasBoth;
      details.append(
        el(
          'summary',
          hasBoth ? '查看或调整优化前原稿与 AI 建议（已自动带入）' : '填写优化工具、原稿与 AI 建议',
        ),
      );
      const inner = el('div', undefined, 'creation-opt-fields');
      const optTool = field(inner, '优化工具', ai.tool_name, (v) => {
        ai.tool_name = v;
        update();
      });
      optTool.rows = 1;
      const origInput = field(inner, '优化前的原稿', ai.original_prompt, (v) => {
        ai.original_prompt = v;
        update();
      });
      origInput.rows = 2;
      const sugInput = field(inner, 'AI给出的建议稿', ai.suggested_prompt, (v) => {
        ai.suggested_prompt = v;
        update();
      });
      sugInput.rows = 2;
      details.append(inner);
      aiBlock.block.append(details);
    }
    root.append(aiBlock.block);
  }

  function renderReflection() {
    let upload;
    try {
      upload = JSON.parse(getAnswers()['final-upload'] || '{}');
    } catch {
      upload = {};
    }
    const works = upload.works || [];
    if (!works.length || !works.some((w) => w.media_id)) {
      root.append(el('p', '先在“上传定稿作品”中上传图片并提交，再来填写反思。'));
      return;
    }

    const optimized = works.filter((w) => w.ai_optimization?.used);
    const pool = optimized.length ? optimized : works;
    state.ai_review ||= {};
    const r = state.ai_review;
    if (!r.work_key || !pool.some((w) => w.key === r.work_key)) {
      r.work_key = pool[0].key;
      input.value = JSON.stringify(state);
    }
    const selected = pool.find((w) => w.key === r.work_key) || pool[0];

    // 块 1：回看定稿图文（与优化前后对照）
    const refBlock = createNoteBlock(
      '回看本次定稿',
      'is-review-ref',
      optimized.length ? '已用 AI 优化' : '自主改词定稿',
    );
    if (pool.length > 1) {
      field(
        refBlock.block,
        '本次反思对应',
        r.work_key,
        (v) => {
          r.work_key = v;
          update();
          render();
        },
        pool.map((w, i) => [w.key, w.title || `作品 ${i + 1}`]),
      );
    }

    const preview = el('div', undefined, 'original-rating-preview creation-review-ref-grid');
    const fig = el('figure', undefined, 'original-student-image');
    if (selected.media_id) {
      const image = el('img');
      image.src = `/api/creation/media/${selected.media_id}`;
      image.alt = selected.title || '本次定稿作品';
      fig.append(pictureLink(image));
    }
    fig.append(el('figcaption', selected.title || '我的定稿作品'));
    preview.append(fig, el('blockquote', selected.prompt, 'original-quote'));
    refBlock.block.append(preview);

    if (selected.ai_optimization?.used) {
      const ai = selected.ai_optimization;
      const diff = el('div', undefined, 'creation-opt-compare');
      const before = el('div', undefined, 'creation-opt-compare-col');
      before.append(el('em', '优化前原稿'), el('p', ai.original_prompt || '未填'));
      const after = el('div', undefined, 'creation-opt-compare-col');
      after.append(el('em', 'AI 建议稿'), el('p', ai.suggested_prompt || '未填'));
      diff.append(before, after);
      refBlock.block.append(diff);
    }
    root.append(refBlock.block);

    // 块 2：反思与总结
    const reflectBlock = createNoteBlock(
      optimized.length ? 'AI 使用轻量反思' : '本次创作总结',
      'is-reflection',
    );
    field(
      reflectBlock.block,
      '实际效果是否符合预期',
      r.match,
      (v) => {
        r.match = v;
        update();
      },
      matches,
    );
    const questionLabel = optimized.length
      ? 'AI帮我改了什么？我采纳或调整了什么？'
      : '本次自主改词最满意的一处，或下一次还想调整什么？';
    const choice = field(reflectBlock.block, questionLabel, r.change_and_choice, (v) => {
      r.change_and_choice = v;
      update();
    });
    choice.rows = 3;
    choice.maxLength = 4000;
    choice.placeholder = optimized.length
      ? '例如：文心一言把月夜和光线描写变细了，我采纳了石阶和反光，同时删掉了多余修饰，自己补充了水墨画风。'
      : '例如：我补充了“工笔重彩”和“云雾山巅”，猫的毛发和微光更清楚了，下次想再调一下构图视角。';
    root.append(reflectBlock.block);
  }

  function render() {
    root.replaceChildren();
    if (q.record_form === 'portfolio_upload') renderUpload();
    else renderReflection();
  }

  render();
  return root;
}
