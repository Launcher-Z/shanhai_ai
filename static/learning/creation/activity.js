import { api, el, field, button, copy } from './common.js';
import { store } from './storage.js';
import { referenceFigure, selectableBeasts } from './beast-reference.js';
import { promptNotebook } from './prompt-notebook.js';
import { createDraftStudio } from './draft-studio.js';
import { createPolishStudio } from './polish-studio.js';
import { createCollectionDrawer } from './collection-drawer.js';
import { createGalleryAtelier } from './gallery-atelier.js';

export async function mountCreation(root, activity) {
  const data = await api('/api/creation/tools');
  const storage = store(data.student_id, activity.id);
  let state = storage.read(),
    closed = false,
    previewUrl,
    loadedBlob;
  const write = () => {
    if (!storage.write(state)) message.textContent = '本机保存失败，请复制保留提示词和下载的图片。';
  };
  root.replaceChildren();
  const message = el('p', '', 'creation-message');
  message.setAttribute('role', 'status');
  const canvas = el('div', undefined, 'creation-panel');
  root.append(canvas, message);
  const isRecognition = activity.id === 'lesson-8-task-1',
    isOriginal = activity.id === 'lesson-8-task-2',
    isDraft = activity.id === 'lesson-9-task-1',
    isGallery = activity.id === 'lesson-9-task-2',
    isPolish = activity.id === 'lesson-9-task-3';
  const collectionNotebook = isGallery || isPolish ? promptNotebook(data.student_id) : null;
  let config = data.tools,
    draftStudio,
    polishStudio,
    galleryAtelier,
    collectionDrawer;
  function external(host, kind) {
    const a = el(
      'a',
      kind === 'recognize' ? '打开识图应用' : kind === 'optimize' ? '前往文心一言优化 ↗' : '前往文心一言绘图 ↗',
      'creation-link',
    );
    a.href = config[kind].external_url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    host.append(a);
    return a;
  }
  const promptText = () =>
    isOriginal ? data.beasts.find((b) => b.id === state.beast_id)?.text || '' : state.prompt || '';
  async function rememberBlob(blob, mode = 'external', prompt = promptText()) {
    loadedBlob = blob;
    state.candidate_prompt = prompt;
    state.generation_mode = mode;
    write();
    try {
      await storage.blob('put', blob);
    } catch (e) {
      message.textContent = e.message;
    }
    showPreview();
  }
  function showPreview(targetHost) {
    const old = root.querySelector('.creation-candidate');
    old?.remove();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!loadedBlob) return;
    previewUrl = URL.createObjectURL(loadedBlob);
    const image = el('img', undefined, 'creation-candidate');
    image.src = previewUrl;
    image.alt = '当前候选作品';
    (targetHost || draftStudio?.previewHost() || polishStudio?.previewHost() || canvas).append(image);
  }
  async function run(kind, body, host, done) {
    if (closed) return;
    message.textContent = '正在等待AI结果…';
    // 回应丢失后重试同一请求编号，避免学生再次点击而重复计费。
    const signature = JSON.stringify([kind, body]);
    const requestId =
      state.pendingRequest?.signature === signature ? state.pendingRequest.id : crypto.randomUUID();
    state.pendingRequest = { signature, id: requestId };
    write();
    if (kind === 'optimize') {
      state.optimization_original = body.original_prompt;
      state.optimization_mode = 'internal';
      write();
    }
    const job = await api(`/api/creation/ai/${kind}`, {
      activity_id: activity.id,
      request_id: requestId,
      ...body,
    });
    state.job = {
      id: job.job_id,
      kind,
      prompt: body.prompt || data.beasts.find((b) => b.id === body.beast_id)?.text || '',
    };
    state.pendingRequest = null;
    write();
    await poll(host, done);
  }
  async function poll(host, done) {
    while (!closed && state.job) {
      const id = state.job.id,
        job = await api(`/api/creation/ai/jobs/${id}`);
      if (closed) return;
      if (job.status === 'failed') {
        state.job = null;
        write();
        throw new Error(job.error || '调用未完成，请保留输入，使用外部应用继续。');
      }
      if (job.status === 'succeeded') {
        if (job.image_url) {
          const r = await fetch(job.image_url);
          if (!r.ok) throw new Error('结果图片已失效，请重新生成或使用外部应用。');
          await rememberBlob(await r.blob(), 'internal', state.job.prompt);
        } else {
          state.ai_result = job.text;
          if (state.job.kind === 'optimize') {
            state.suggestion = job.text;
            state.ai_used = true;
          }
          write();
          const p = el('p', job.text, 'creation-ai-result');
          host.append(p);
          done?.(job.text);
        }
        state.job = null;
        write();
        message.textContent = '结果已回到本机。选定后请在札记中提交。';
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1600));
    }
  }
  if (isGallery) {
    galleryAtelier = createGalleryAtelier({
      canvas,
      collectionNotebook,
      message,
      dialog: root.closest('dialog'),
    });
    await galleryAtelier.init();
  } else if (isRecognition) {
    canvas.append(el('h3', '重新看看四张旧图片'));
    const ask = '图中有什么特征？你认为它是什么？哪些地方不能确定？';
    canvas.append(
      el('p', ask),
      button('复制统一提问', () => copy(ask)),
    );
    external(canvas, 'recognize');
    const grid = el('div', undefined, 'creation-grid');
    for (let i = 1; i <= 4; i++) {
      const card = el('article'),
        img = el('img');
      img.src = `/static/learning/creation/images/image-${i}.png`;
      img.alt = `编号${i}`;
      card.append(img, el('h4', `编号 ${i}`));
      const a = el('a', '下载编号图');
      a.href = img.src;
      a.download = `编号${i}.png`;
      card.append(a);
      if (config.recognize.mode === 'internal')
        card.append(button('请AI看看这张图', () => run('recognize', { beast_id: `image-${i}` }, card)));
      grid.append(card);
    }
    canvas.append(grid);
    canvas.append(el('p', '先保留AI的回答，再结合图像和原文核对。它可以保留疑问，也可能认错。'));
    const details = el('details');
    details.append(el('summary', '核对原文资料'));
    selectableBeasts(data.beasts).forEach((b) =>
      details.append(el('h4', b.name), el('p', b.text), el('small', b.source)),
    );
    canvas.append(details);
    canvas.append(el('p', '到右上角学习札记，记录AI的关键回答和自己的判断，做完一张提交一张。'));
  } else {
    if (isPolish) {
      const headBar = el('div', undefined, 'creation-head-bar');
      headBar.append(el('h3', '接着初稿，再炼一笔'));
      const trigger = el('button', undefined, 'creation-collection-trigger');
      trigger.type = 'button';
      const badge = el('span', '札', 'creation-collection-badge');
      badge.setAttribute('aria-hidden', 'true');
      trigger.append(badge, el('span', '我的提示词收藏本'));
      headBar.append(trigger);
      canvas.append(headBar);
      collectionDrawer = createCollectionDrawer({
        anchorDialog: root.closest('dialog'),
        trigger,
        notebook: collectionNotebook,
      });
    } else {
      canvas.append(el('h3', isOriginal ? '让原文自己说话' : '把身边的动物带进山海'));
    }
    if (isOriginal) {
      const quote = el('blockquote');
      const source = el('small');
      const reference = el('div');
      const text = el('div');
      text.append(quote, source);
      const sourceLayout = el('div', undefined, 'original-source-layout');
      sourceLayout.append(reference, text);
      const refresh = () => {
        const b = data.beasts.find((x) => x.id === state.beast_id);
        reference.replaceChildren(referenceFigure(b));
        reference.hidden = !b?.image;
        sourceLayout.classList.toggle('is-empty', !b?.image);
        quote.textContent = b?.text || '请选择一段原文';
        source.textContent = b?.source || '';
      };
      field(
        canvas,
        '选择原文',
        state.beast_id,
        (v) => {
          state.beast_id = v;
          write();
          refresh();
        },
        [['', '请选择'], ...selectableBeasts(data.beasts, state.beast_id).map((b) => [b.id, b.name])],
      );
      canvas.append(sourceLayout);
      refresh();
      canvas.append(el('p', '新建生图对话，只输入这一段原文；保留第一次结果，即使不理想。'));
      const actions = el('div', undefined, 'creation-actions');
      actions.append(
        button('复制原文', () => {
          if (!promptText()) throw new Error('请先选择原文。');
          return copy(promptText());
        }),
      );
      const launch = external(actions, 'generate');
      launch.classList.add('creation-launch');
      canvas.append(actions);

      const originalGallerySection = el('section', undefined, 'creation-original-gallery');
      originalGallerySection.append(el('h4', '同学们的原文绘兽作品', 'creation-original-gallery-title'));
      const originalGalleryHost = el('div', undefined, 'creation-original-gallery-host');
      originalGallerySection.append(originalGalleryHost);
      canvas.append(originalGallerySection);
      galleryAtelier = createGalleryAtelier({
        canvas: originalGalleryHost,
        collectionNotebook: null,
        message,
        dialog: root.closest('dialog'),
        fixedActivityId: 'lesson-8-task-2',
        allowCollect: false,
        promptTitle: '所用《山海经》原文',
        autoplayPausedByDefault: true,
        emptyLines: ['老师审核并发布同学作品后，将在这里按宣纸画卷形式展出。'],
      });
      galleryAtelier.init().catch((err) => {
        message.textContent = err.message;
      });
    } else if (isDraft) {
      if (config.generate.mode === 'internal') {
        try {
          loadedBlob = await storage.blob('get');
        } catch (e) {
          message.textContent = e.message;
        }
      }
      draftStudio = createDraftStudio({
        canvas,
        state,
        write,
        animals: data.animals || [],
        library: data.library || [],
        config,
        promptText,
        onGenerateInternal: (host) => run('generate', { prompt: promptText() }, host),
        onMountPreview: (host) => showPreview(host),
      });
    } else {
      if (config.generate.mode === 'internal') {
        try {
          loadedBlob = await storage.blob('get');
        } catch (e) {
          message.textContent = e.message;
        }
      }
      polishStudio = createPolishStudio({
        canvas,
        state,
        write,
        studentId: data.student_id,
        animals: data.animals || [],
        library: data.library || [],
        config,
        message,
        promptText,
        onOptimizeInternal: (host, originalPrompt, done) =>
          run('optimize', { original_prompt: originalPrompt }, host, done),
        onGenerateInternal: (host) => run('generate', { prompt: promptText() }, host),
        onMountPreview: (host) => showPreview(host),
      });
    }
  }
  if (state.job) canvas.append(button('查看上次AI结果', () => poll(canvas)));
  const controller = {
    collectionNotebook,
    beasts: data.beasts,
    candidate: () => Promise.resolve(loadedBlob),
    draft: () => {
      const animal = draftStudio?.animalInfo?.() || { id: state.animal_id || '', name: state.animal_name || '' };
      return {
        prompt: loadedBlob ? state.candidate_prompt || promptText() : promptText(),
        animal_id: animal.id,
        animal_name: animal.name,
        tool: {
          mode: state.generation_mode || 'external',
          name: state.generation_mode === 'internal' ? '火山引擎' : '文心一言',
          model: '',
        },
        beast_id: state.beast_id,
        ai_optimization: {
          used: Boolean(state.ai_used),
          mode: state.optimization_mode || 'external',
          tool_name: '文心一言',
          original_prompt: state.optimization_original || '',
          suggested_prompt: state.suggestion || '',
        },
      };
    },
    pause() {
      closed = true;
      draftStudio?.destroy?.();
      polishStudio?.destroy?.();
      galleryAtelier?.destroy?.();
      collectionDrawer?.destroy?.();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    async reset() {
      controller.pause();
      await storage.clear();
      const next = await mountCreation(root, activity);
      // 保留同一个控制器引用，让连续重置后札记仍读取最新候选图。
      const { reset: unusedReset, ...methods } = next;
      Object.assign(controller, methods);
    },
    setGate() {},
    goToStep() {},
  };
  return controller;
}
