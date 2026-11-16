import { el, api, button, field, matches, blankWork } from './common.js';
import { createOriginalForm } from './original-form.js';
import { createDraftForm } from './draft-form.js';
import { createPortfolioForm } from './portfolio-form.js';
import { selectableBeasts } from './beast-reference.js';
import {createTrainingEvidence} from '../animal-improvement/evidence.js';
import { createPixelWorkForm } from '../pixel-paint/note.js';

export function createCreationForm(q, input, activityId, controller, getAnswers = () => ({})) {
  if(q.record_form==='training_evidence')return createTrainingEvidence(input,controller);
  if(q.record_form==='pixel')return createPixelWorkForm(q,input,activityId,controller);
  if (q.record_form === 'original_upload' || q.record_form === 'original_rating') {
    return createOriginalForm(q, input, activityId, controller, getAnswers);
  }
  if (q.record_form === 'draft_upload' || q.record_form === 'draft_rating') {
    return createDraftForm(q, input, activityId, controller, getAnswers);
  }
  if (q.record_form === 'portfolio_upload' || q.record_form === 'portfolio_reflection') {
    return createPortfolioForm(q, input, activityId, controller, getAnswers);
  }
  const root = el('div', undefined, 'creation-form');
  let state;
  try {
    state = JSON.parse(input.value);
  } catch {
    state =
      q.record_form === 'recognition'
        ? { schema_version: 1 }
        : { schema_version: 1, works: [], ai_review: null };
  }
  const update = () => {
    input.value = JSON.stringify(state);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  function pictureLink(image) {
    const link = el('a');
    link.href = image.src;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = '点击查看大图';
    link.setAttribute('aria-label', '查看原尺寸作品');
    link.append(image);
    return link;
  }
  function createWorkFromDraft() {
    const w = blankWork(),
      draft = controller?.draft?.();
    if (draft) {
      w.prompt = draft.prompt || '';
      w.ai_optimization = draft.ai_optimization || { used: false };
      w.tool = draft.tool || w.tool;
    }
    if (!w.tool.name) w.tool.name = '文心一言';
    if (!w.tool.mode) w.tool.mode = 'external';
    if (w.ai_optimization && !w.ai_optimization.tool_name) w.ai_optimization.tool_name = '文心一言';
    if (q.record_form === 'original') {
      state.beast_id ||= draft?.beast_id;
      w.prompt = controller?.beasts.find((b) => b.id === state.beast_id)?.text || '';
      w.ai_optimization = { used: false };
    }
    return w;
  }
  let initializedDefaultWork = false;
  function render() {
    root.replaceChildren();
    if (q.record_form === 'recognition') {
      state.observations ||= Array.from({ length: 4 }, (_, i) => ({
        image_id: `image-${i + 1}`,
        features: '',
        ai_answer: '',
        verification: '',
      }));
      state.observations.forEach((row, i) => {
        const section = el('section');
        section.append(el('h4', `编号 ${i + 1}`));
        for (const [key, label] of [
          ['ai_answer', 'AI的关键回答'],
          ['verification', '我的判断：哪些可信，哪些有疑问？'],
        ])
          field(section, label, row[key], (v) => {
            row[key] = v;
            update();
          });
        root.append(section);
      });
      return;
    }
    if (q.record_form === 'original') {
      const beasts = controller?.beasts || [];
      field(
        root,
        '使用的原文',
        state.beast_id,
        (v) => {
          state.beast_id = v;
          state.evaluation = {};
          if (state.works[0]) state.works[0].prompt = beasts.find((b) => b.id === v)?.text || '';
          update();
          render();
        },
        [['', '请选择'], ...selectableBeasts(beasts, state.beast_id).map((b) => [b.id, b.name])],
      );
    }
    if (q.record_form === 'portfolio' && !initializedDefaultWork) {
      initializedDefaultWork = true;
      if (!state.works.length) {
        state.works.push(createWorkFromDraft());
        input.value = JSON.stringify(state);
      }
    }
    const latestDraft = controller?.draft?.();
    state.works.forEach((work, index) => {
      const part = el('section', undefined, 'creation-work');
      part.append(el('h4', `作品 ${index + 1}`));
      if (!work.tool) work.tool = { mode: 'external', name: '文心一言', model: '' };
      if (!work.tool.name) work.tool.name = latestDraft?.tool?.name || '文心一言';
      if (!work.tool.mode) work.tool.mode = latestDraft?.tool?.mode || 'external';
      field(part, '作品名', work.title, (v) => {
        work.title = v;
        update();
      });
      const file = el('input');
      file.type = 'file';
      file.accept = 'image/png,image/jpeg,image/webp';
      const label = el('label', '上传作品图片（自动压缩并随札记保存）');
      label.append(file);
      part.append(label);
      let errorNode;
      const showError = (msg) => {
        if (!errorNode) {
          errorNode = el('p', msg, 'creation-error');
          part.append(errorNode);
        } else {
          errorNode.textContent = msg;
        }
      };
      async function upload(blob) {
        if (root.dataset.uploading) return;
        if (blob.size > 12 * 1024 * 1024) {
          showError('请选择12MB以内的图片。');
          return;
        }
        root.dataset.uploading = 'true';
        file.disabled = true;
        try {
          const data = new FormData();
          data.append('file', blob, '作品.png');
          data.append('activity_id', activityId);
          data.append('csrf', document.querySelector('meta[name="csrf-token"]').content);
          const r = await api('/api/creation/media', data);
          work.media_id = r.media_id;
          const currentDraft = controller?.draft?.();
          if (currentDraft && q.record_form === 'portfolio') {
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
        const image = el('img', undefined, 'original-upload-preview');
        image.src = `/api/creation/media/${work.media_id}/thumbnail`;
        image.alt = work.title || '选定作品';
        part.append(pictureLink(image));
        part.append(el('p', '已上传作品图片；核对提示词后，点击下方“暂存本段”或“提交本段”即可保存。'));
      }
      const prompt = field(part, '实际生成这张图的完整提示词', work.prompt, (v) => {
        work.prompt = v;
        update();
      });
      if (q.record_form === 'portfolio' && latestDraft?.prompt && latestDraft.prompt !== work.prompt) {
        part.append(
          button('同步活动中的提示词', () => {
            work.prompt = latestDraft.prompt;
            prompt.value = latestDraft.prompt;
            if (latestDraft.ai_optimization?.used && !work.ai_optimization?.used) {
              work.ai_optimization = latestDraft.ai_optimization;
              update();
              render();
              return;
            }
            update();
          }),
        );
      }
      if (q.record_form === 'original') {
        prompt.readOnly = true;
        part.append(el('p', '原文直出结果请保留第一次，不必挑选最好看的图。'));
      }
      field(part, '生图应用名称', work.tool.name, (v) => {
        work.tool.name = v;
        update();
      });
      if (q.record_form !== 'original') {
        const ai = work.ai_optimization;
        field(
          part,
          '是否用过AI优化提示词（舍弃建议也选“用过”）',
          ai.used ? 'yes' : 'no',
          (v) => {
            ai.used = v === 'yes';
            if (!ai.used && state.ai_review?.work_key === work.key) state.ai_review = null;
            update();
            render();
          },
          [
            ['no', '没有，仅自己编写'],
            ['yes', '用过AI优化建议'],
          ],
        );
        if (ai.used) {
          field(part, '优化工具', ai.tool_name, (v) => {
            ai.tool_name = v;
            update();
          });
          field(part, '优化前的原稿', ai.original_prompt, (v) => {
            ai.original_prompt = v;
            update();
          });
          field(part, 'AI给出的建议稿', ai.suggested_prompt, (v) => {
            ai.suggested_prompt = v;
            update();
          });
        }
      }
      part.append(
        button('移除这份作品', () => {
          state.works.splice(index, 1);
          if (state.ai_review?.work_key === work.key) state.ai_review = null;
          update();
          render();
        }),
      );
      root.append(part);
    });
    const max = q.record_form === 'portfolio' ? 3 : 1;
    if (state.works.length < max)
      root.append(
        button('添加作品', () => {
          state.works.push(createWorkFromDraft());
          update();
          render();
        }),
      );
    if (q.record_form === 'original') {
      state.evaluation ||= {};
      const e = state.evaluation;
      for (const [k, l] of [
        ['accuracy', '原文特征符合度'],
        ['spirit', '神韵与氛围感'],
        ['expression', '艺术表现与视觉表达'],
      ])
        field(
          root,
          l,
          e[k],
          (v) => {
            e[k] = v;
            update();
          },
          matches,
        );
      const beast = controller?.beasts.find((b) => b.id === state.beast_id);
      const list = el('div');
      list.append(el('p', '遗漏或画错的特征（可多选）'));
      beast?.features.forEach((f) => {
        const label = el('label', f),
          c = el('input');
        c.type = 'checkbox';
        c.checked = (e.errors || []).includes(f);
        c.addEventListener('change', () => {
          e.errors = c.checked ? [...(e.errors || []), f] : (e.errors || []).filter((x) => x !== f);
          update();
        });
        label.prepend(c);
        list.append(label);
      });
      root.append(list);
      field(root, '一处具体细节：画面与原文有什么对应或落差', e.detail, (v) => {
        e.detail = v;
        update();
      });
    }
    const optimized = state.works.filter((w) => w.ai_optimization.used);
    if (optimized.length && q.record_form === 'portfolio') {
      root.append(el('h4', 'AI使用轻量反思（用过AI优化再填）'));
      if (!state.ai_review || !optimized.some((w) => w.key === state.ai_review.work_key)) {
        state.ai_review = { ...(state.ai_review || {}), work_key: optimized[0].key };
      }
      const r = state.ai_review;
      if (optimized.length > 1) {
        field(
          root,
          '本次反思对应',
          r.work_key,
          (v) => {
            r.work_key = v;
            update();
          },
          optimized.map((w, i) => [w.key, w.title || `作品${i + 1}`]),
        );
      }
      field(
        root,
        '实际效果是否符合预期',
        r.match,
        (v) => {
          r.match = v;
          update();
        },
        matches,
      );
      const choice = field(root, 'AI帮我改了什么？我采纳或调整了什么？', r.change_and_choice, (v) => {
        r.change_and_choice = v;
        update();
      });
      choice.rows = 2;
      choice.placeholder = '例如：文心一言把月夜和光线描写变细了，我采纳了石阶和反光，同时删掉了多余修饰，自己补充了水墨画风。';
    } else state.ai_review = null;
  }
  render();
  return root;
}
