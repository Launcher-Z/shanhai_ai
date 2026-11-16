/* 8.2两段札记：分块卡片排版（使用的原文 / 原文直出作品；回看原文与作品 / 三维度评分 / 评分理由）。 */
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
import { referenceFigure, selectableBeasts } from './beast-reference.js';

const criteria = [
  ['accuracy', '原文特征符合度', '形态、颜色、器官数量与位置，是否对应原文？'],
  ['spirit', '神韵与氛围感', '画面是否传达出你理解的山海神异气息？'],
  ['expression', '艺术表现与视觉表达', '主体是否清楚，关键细节是否容易看见，画面是否协调？'],
];

export function createOriginalForm(q, input, activityId, controller, getAnswers) {
  const root = el('div', undefined, 'creation-form original-form is-draft-form is-original-form');
  let state;
  try {
    state = JSON.parse(input.value);
  } catch {
    state = { schema_version: 1 };
  }
  const beasts = controller?.beasts || [];
  const update = () => {
    input.value = JSON.stringify(state);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  function render() {
    root.replaceChildren();
    if (q.record_form === 'original_upload') {
      state.works ||= [];
      const beast = beasts.find((b) => b.id === state.beast_id);

      // 块 1：使用的原文（选择 + 古籍图文对照）
      const beastBlock = createNoteBlock('使用的原文', 'is-meta', beast?.source || '');
      const choice = field(
        beastBlock.block,
        '选择本次使用的原文',
        state.beast_id,
        (id) => {
          state.beast_id = id;
          if (state.works[0]) {
            const b = beasts.find((item) => item.id === id);
            state.works[0].prompt = b?.text || '';
            state.works[0].title = b ? `${b.name} · 原文直出` : '';
          }
          update();
          render();
        },
        [['', '请选择'], ...selectableBeasts(beasts, state.beast_id).map((b) => [b.id, b.name])],
      );
      if (beast) {
        const refRow = el(
          'div',
          undefined,
          `creation-original-ref-row${beast.image ? '' : ' is-no-img'}`,
        );
        if (beast.image) refRow.append(referenceFigure(beast));
        const textCol = el('div', undefined, 'creation-original-ref-text');
        textCol.append(el('h4', beast.name), el('blockquote', beast.text, 'original-quote'));
        refRow.append(textCol);
        beastBlock.block.append(refRow);
      }
      root.append(beastBlock.block);

      // 块 2：原文直出作品上传
      const mediaBlock = createNoteBlock(
        '原文直出作品',
        'is-media',
        state.works[0]?.media_id ? '已上传' : '待上传',
      );
      const file = el('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp';
      const label = el('label', '上传原文生成的图片', 'creation-upload-label');
      label.append(file);

      let errorNode;
      function showError(msg) {
        if (!errorNode) {
          errorNode = el('p', msg, 'creation-error');
          mediaBlock.block.append(errorNode);
        } else {
          errorNode.textContent = msg;
        }
      }

      file.addEventListener('change', async () => {
        if (!file.files[0] || root.dataset.uploading) return;
        root.dataset.uploading = 'true';
        choice.disabled = true;
        file.disabled = true;
        try {
          const result = await uploadCreationMedia(file.files[0], activityId);
          const currentBeast = beasts.find((b) => b.id === state.beast_id);
          const work = state.works[0] || blankWork();
          work.media_id = result.media_id;
          work.prompt = currentBeast?.text || '';
          work.title = currentBeast ? `${currentBeast.name} · 原文直出` : '';
          work.tool = { mode: 'external', name: '文心一言', model: '' };
          work.ai_optimization = { used: false };
          state.works = [work];
          update();
          render();
        } catch (error) {
          showError(error.message);
        } finally {
          delete root.dataset.uploading;
          choice.disabled = false;
          file.disabled = false;
        }
      });

      if (state.works[0]?.media_id) {
        const previewRow = el('div', undefined, 'creation-upload-preview-row');
        const image = el('img', undefined, 'original-upload-preview');
        image.src = `/api/creation/media/${state.works[0].media_id}`;
        image.alt = '本次上传的原文生成作品';
        const thumbLink = pictureLink(image, 'creation-upload-thumb');
        const side = el('div', undefined, 'creation-upload-side');
        side.append(label, el('small', '提交本部分后，切换到“打分与评价”回看这张图。'));
        previewRow.append(thumbLink, side);
        mediaBlock.block.append(previewRow);
      } else {
        const drop = el('div', undefined, 'creation-upload-drop');
        drop.append(label, el('small', '上传这一段原文第一次直接生成的图片，即使效果不理想也保留。'));
        mediaBlock.block.append(drop);
      }
      root.append(mediaBlock.block);
      return;
    }

    let upload;
    try {
      upload = JSON.parse(getAnswers()['original-upload'] || '{}');
    } catch {
      upload = {};
    }
    const work = upload.works?.[0];
    if (!work?.media_id) {
      root.append(el('p', '先在“上传作品”中选择原文、上传图片并提交，再来打分。', 'creation-empty-hint'));
      return;
    }
    state.media_id ||= work.media_id;
    state.beast_id ||= upload.beast_id;
    const beast = beasts.find((b) => b.id === state.beast_id);

    // 块 1：回看原文与作品
    const refBlock = createNoteBlock('回看原文与作品', 'is-review-ref', beast?.name || '');
    if (state.media_id !== work.media_id || state.beast_id !== upload.beast_id) {
      const changedBar = el('div', undefined, 'creation-note-stale');
      changedBar.append(
        el('span', '上传部分已有新作品，下面保留上次评分对应的图文。'),
        button('重新评价当前上传的作品', () => {
          state.media_id = work.media_id;
          state.beast_id = upload.beast_id;
          state.evaluation = {};
          update();
          render();
        }),
      );
      refBlock.block.append(changedBar);
    }

    const preview = el('section', undefined, 'original-rating-preview');
    const image = el('img');
    image.src = `/api/creation/media/${state.media_id}`;
    image.alt = work.title || '本次评价的作品';
    const comparison = el('div', undefined, 'original-image-comparison');
    const own = el('figure', undefined, 'original-student-image');
    own.append(pictureLink(image), el('figcaption', '我的原文生成图'));
    if (beast?.image) comparison.append(referenceFigure(beast));
    comparison.append(own);
    preview.append(comparison);
    if (beast) {
      preview.append(el('blockquote', beast.text, 'original-quote'), el('small', beast.source));
    }
    refBlock.block.append(preview);
    root.append(refBlock.block);

    // 块 2：三维度评分
    const scoreBlock = createNoteBlock('三维度评分', 'is-scoring', '0分未体现 · 5分非常理想');
    state.evaluation ||= {};
    renderScoreRails(scoreBlock.block, q.id, state.evaluation, criteria, update, { compact: true });
    root.append(scoreBlock.block);

    // 块 3：评分理由
    const noteBlock = createNoteBlock('', 'is-reflection');
    noteBlock.titleNode.remove();
    const detail = createLabeledTextarea(
      noteBlock.head,
      '结合画面说明评分理由',
      `${q.id}-detail-input`,
      state.evaluation.detail,
      (value) => {
        state.evaluation.detail = value;
        update();
      },
      3,
      '可以这样写：原文说“____”，图中画成了“____”，因此我给原文特征____分；画面中的____让我感到____。如果再生成一次，我想让____更清楚。',
    );
    detail.maxLength = 2000;
    noteBlock.block.append(
      detail,
      el(
        'p',
        '至少指出一处“原文—画面”的对应或偏差，再结合神韵、构图或细节说明评分理由；也可以补充下一次想改什么。',
        'original-detail-hint',
      ),
    );
    root.append(noteBlock.block);
  }

  render();
  return root;
}
