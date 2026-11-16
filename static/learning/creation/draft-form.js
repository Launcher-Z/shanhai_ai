/* 9.1两段札记：分块卡片排版（初稿画面 / 作品信息 / 生成提示词；回看初稿 / 维度自评 / 自评说明）。 */
import {
  el,
  field,
  blankWork,
  button,
  uploadCreationMedia,
  renderScoreRails,
  pictureLink,
  createNoteBlock,
  createLabeledTextarea,
} from './common.js';

const draftCriteria = [
  ['feature_keep', '动物特征保留度', '画面里还看得出所选动物的外形特点吗？'],
  ['magical_detail', '神异细节可见度', '赋予的神异能力有没有变成画面里看得见的细节？'],
  ['visual_harmony', '画面与风格协调度', '构图、光线与整体画风是否符合预期？'],
];

export function createDraftForm(q, input, activityId, controller, getAnswers) {
  const root = el('div', undefined, 'creation-form original-form is-draft-form');
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

  function render() {
    root.replaceChildren();
    if (q.record_form === 'draft_upload') {
      const draft = controller?.draft?.() || {};
      state.works ||= [];
      const work = state.works[0] || blankWork();
      if (!work.tool.name) work.tool.name = draft.tool?.name || '文心一言';
      if (!work.tool.mode) work.tool.mode = draft.tool?.mode || 'external';
      if (!state.animal_id && draft.animal_id) state.animal_id = draft.animal_id;
      if (!state.animal_name && draft.animal_name) state.animal_name = draft.animal_name;
      if (!work.prompt && draft.prompt) {
        work.prompt = draft.prompt;
        state.works = [work];
        input.value = JSON.stringify(state);
      }

      const syncWork = () => {
        state.works = [work];
        update();
      };

      // 块 1：初稿画面上传与紧凑预览
      const mediaBlock = createNoteBlock('初稿画面', 'is-media', work.media_id ? '已上传' : '待上传');
      const file = el('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp';
      const fileLabel = el('label', '上传初稿图片（自动压缩并随札记保存）', 'creation-upload-label');
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
          const latest = controller?.draft?.() || {};
          if (!work.prompt && latest.prompt) work.prompt = latest.prompt;
          if (!state.animal_id && latest.animal_id) state.animal_id = latest.animal_id;
          if (!state.animal_name && latest.animal_name) state.animal_name = latest.animal_name;
          if (latest.tool?.mode) work.tool.mode = latest.tool.mode;
          if (!work.tool.name && latest.tool?.name) work.tool.name = latest.tool.name;
          syncWork();
          render();
        } catch (error) {
          showError(error.message);
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
        image.src = `/api/creation/media/${work.media_id}`;
        image.alt = work.title || '本次上传的初稿作品';
        const thumbLink = pictureLink(image, 'creation-upload-thumb');
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
      const metaBlock = createNoteBlock('作品信息', 'is-meta', state.animal_name ? `原型：${state.animal_name}` : '');
      const metaRow = el('div', undefined, 'creation-note-row creation-note-row--2');
      const titleInput = field(metaRow, '作品名', work.title, (v) => {
        work.title = v;
        syncWork();
      });
      titleInput.rows = 1;
      titleInput.placeholder = state.animal_name ? `例：${state.animal_name}·灵兽初稿` : '给初稿起个名字';

      const toolInput = field(metaRow, '生图应用名称', work.tool.name, (v) => {
        work.tool.name = v;
        syncWork();
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
        `${q.id}-prompt-input`,
        work.prompt,
        (v) => {
          work.prompt = v;
          syncWork();
        },
        3,
      );
      if (draft.prompt && draft.prompt !== work.prompt) {
        const syncBtn = button('同步活动中的提示词', () => {
          work.prompt = draft.prompt;
          promptInput.value = draft.prompt;
          if (!state.animal_name && draft.animal_name) state.animal_name = draft.animal_name;
          syncWork();
        });
        syncBtn.classList.add('creation-note-inline-btn');
        promptBlock.head.append(syncBtn);
      }
      promptBlock.block.append(promptInput);
      root.append(promptBlock.block);
      return;
    }

    let upload;
    try {
      upload = JSON.parse(getAnswers()['draft-upload'] || '{}');
    } catch {
      upload = {};
    }
    const work = upload.works?.[0];
    if (!work?.media_id) {
      root.append(el('p', '先在“上传初稿与提示词”中上传图片并提交，再来初稿自评。'));
      return;
    }
    state.media_id ||= work.media_id;
    state.animal_name ||= upload.animal_name || '';

    // 块 1：回看初稿图文（暖底参考卡片）
    const refBlock = createNoteBlock('回看本次初稿', 'is-review-ref', state.animal_name ? `原型：${state.animal_name}` : '');
    if (state.media_id !== work.media_id) {
      const changedBar = el('div', undefined, 'creation-note-stale');
      changedBar.append(
        el('span', '上传部分已有新图片，当前保留上次自评对应的作品。'),
        button('重新评价当前上传的初稿', () => {
          state.media_id = work.media_id;
          state.animal_name = upload.animal_name || '';
          state.evaluation = {};
          update();
          render();
        }),
      );
      refBlock.block.append(changedBar);
    }

    const preview = el('div', undefined, 'original-rating-preview creation-review-ref-grid');
    const image = el('img');
    image.src = `/api/creation/media/${state.media_id}`;
    image.alt = work.title || '本次自评的初稿作品';
    const fig = el('figure', undefined, 'original-student-image');
    fig.append(pictureLink(image), el('figcaption', work.title || '我的初稿作品'));
    preview.append(fig, el('blockquote', work.prompt, 'original-quote'));
    refBlock.block.append(preview);
    root.append(refBlock.block);

    // 块 2：三维度自评
    const scoreBlock = createNoteBlock('三维度自评', 'is-scoring', '0分未体现 · 5分非常理想');
    state.evaluation ||= {};
    renderScoreRails(scoreBlock.block, q.id, state.evaluation, draftCriteria, update, { compact: true });
    root.append(scoreBlock.block);

    // 块 3：自评说明
    const noteBlock = createNoteBlock('', 'is-reflection');
    noteBlock.titleNode.remove();
    const detail = createLabeledTextarea(
      noteBlock.head,
      '自评说明：最满意的一处，或下一次最想改进的地方',
      `${q.id}-detail-input`,
      state.evaluation.detail,
      (v) => {
        state.evaluation.detail = v;
        update();
      },
      3,
      '例如：保留了猫的竖耳和斑纹，但尾尖微光不够明显，下次想把光源和夜间背景再写具体。',
    );
    detail.maxLength = 2000;
    noteBlock.block.append(detail);
    root.append(noteBlock.block);
  }

  render();
  return root;
}
