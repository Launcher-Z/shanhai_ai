/* 9.2「同学的山海新作」：宣纸画案 · 卷轴双栏展台与像素级宣纸水墨过渡。 */
import { api, el, copy } from './common.js';

function createInkShaderEngine() {
  const glCanvas = document.createElement('canvas');
  const gl = glCanvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) return null;

  const vsSrc = `#version 300 es
    precision highp float;
    out vec2 v_uv;
    void main() {
      vec2 pos = vec2(
        (gl_VertexID == 1) ? 3.0 : -1.0,
        (gl_VertexID == 2) ? 3.0 : -1.0
      );
      v_uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
      gl_Position = vec4(pos, 0.0, 1.0);
    }
  `;

  const fsSrc = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    out vec4 fragColor;

    uniform float u_t;
    uniform float u_dir;
    uniform float u_aspect;
    uniform vec2 u_seed;
    uniform int u_mode;

    const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm3(vec2 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 3; i++) {
        s += a * vnoise(p);
        p = ROT * p * 2.04 + vec2(13.7, 9.2);
        a *= 0.5;
      }
      return s;
    }

    float fbm5(vec2 p) {
      float s = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        s += a * vnoise(p);
        p = ROT * p * 2.02 + vec2(17.1, 31.7);
        a *= 0.5;
      }
      return s;
    }

    float easeGentleFlow(float x) {
      float c = clamp(x, 0.0, 1.0);
      float sine = 0.5 - 0.5 * cos(c * 3.14159265);
      return mix(c, sine, 0.38);
    }

    float revealMask(float progress, float fVal, float feather) {
      float p = clamp(progress, 0.0, 1.0);
      float front = mix(-feather - 0.002, 1.0 + feather + 0.002, p);
      return smoothstep(front + feather, front - feather, fVal);
    }

    void main() {
      vec2 uv = v_uv;
      vec2 ap = vec2(uv.x * u_aspect, uv.y);

      vec2 r1 = mat2(0.96, 0.28, -0.28, 0.96) * ap;
      vec2 r2 = mat2(0.86, -0.51, 0.51, 0.86) * ap;
      float fibA = vnoise(r1 * vec2(10.0, 38.0) + u_seed * 3.1);
      float fibB = vnoise(r2 * vec2(36.0, 12.0) - u_seed * 2.4);
      float fibMid = fbm3(ap * 14.0 + u_seed * 1.7);
      float softPaper = fibA * 0.26 + fibB * 0.26 + fibMid * 0.48;
      float gentleFiber = softPaper - 0.5;

      vec2 q = vec2(
        fbm5(ap * 1.85 + u_seed),
        fbm5(ap * 1.85 + u_seed + vec2(5.2, 1.9))
      );
      vec2 r = vec2(
        fbm5(ap * 3.2 + 1.45 * q + vec2(1.7, 8.3)),
        fbm5(ap * 3.2 + 1.45 * q + vec2(9.1, 2.6))
      );
      float swirl = fbm5(ap * 2.3 + 1.35 * r + vec2(u_t * 0.09 * u_dir, 0.0));
      float mistFlow = smoothstep(0.18, 0.86, fbm3(ap * 4.5 + r * 1.8));

      float dirX = u_dir > 0.0 ? uv.x : (1.0 - uv.x);
      float waveCurve = 0.048 * sin(uv.y * 3.8 + u_seed.x) + 0.028 * cos(uv.y * 6.4 + u_seed.y);
      float raw = 0.08 + dirX * 0.76 + (swirl - 0.5) * 0.26 + (mistFlow - 0.5) * 0.10 + waveCurve;
      float fSoft = clamp(raw + gentleFiber * 0.032, 0.0, 1.0);

      float waveP = easeGentleFlow(u_t);
      float pFromCol  = clamp(waveP * 1.12, 0.0, 1.0);
      float pFromMono = clamp(waveP * 1.06, 0.0, 1.0);
      float pToMono   = clamp((waveP - 0.08) / 0.90, 0.0, 1.0);
      float pToCol    = clamp((waveP - 0.14) / 0.86, 0.0, 1.0);

      if (u_mode == 0) {
        float a = 1.0 - revealMask(pFromCol, fSoft, 0.175);
        fragColor = vec4(vec3(a), a);
        return;
      }
      if (u_mode == 1) {
        float a = 1.0 - revealMask(pFromMono, fSoft, 0.190);
        fragColor = vec4(vec3(a), a);
        return;
      }
      if (u_mode == 2) {
        float a = revealMask(pToMono, fSoft, 0.190);
        fragColor = vec4(vec3(a), a);
        return;
      }
      if (u_mode == 3) {
        float a = revealMask(pToCol, fSoft, 0.175);
        fragColor = vec4(vec3(a), a);
        return;
      }

      float env = smoothstep(0.0, 0.10, u_t) * (1.0 - smoothstep(0.86, 1.0, u_t));
      float inkFront = mix(-0.14, 1.14, clamp((waveP - 0.03) / 0.94, 0.0, 1.0));
      float d = fSoft - inkFront;

      float washWide = exp(-pow(d / 0.135, 2.0))
                     * (0.35 + 0.65 * swirl)
                     * smoothstep(0.18, 0.82, softPaper);
      float washCore = exp(-pow((d - 0.015) / 0.075, 2.0))
                     * mistFlow;

      float inkAlpha = clamp((washWide * 0.34 + washCore * 0.24) * env, 0.0, 0.44);

      vec3 inkMid  = vec3(0.175, 0.190, 0.182);
      vec3 inkPale = vec3(0.420, 0.440, 0.425);
      vec3 inkCol = mix(inkPale, inkMid, clamp(washCore * 0.85 + swirl * 0.25, 0.0, 1.0));

      fragColor = vec4(inkCol * inkAlpha, inkAlpha);
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  const vao = gl.createVertexArray();
  const loc = {
    t: gl.getUniformLocation(prog, 'u_t'),
    dir: gl.getUniformLocation(prog, 'u_dir'),
    aspect: gl.getUniformLocation(prog, 'u_aspect'),
    seed: gl.getUniformLocation(prog, 'u_seed'),
    mode: gl.getUniformLocation(prog, 'u_mode'),
  };

  return {
    canvas: glCanvas,
    renderMask(gw, gh, t, dir, aspect, seedX, seedY, mode) {
      if (glCanvas.width !== gw || glCanvas.height !== gh) {
        glCanvas.width = gw;
        glCanvas.height = gh;
      }
      gl.viewport(0, 0, gw, gh);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.uniform1f(loc.t, t);
      gl.uniform1f(loc.dir, dir);
      gl.uniform1f(loc.aspect, aspect);
      gl.uniform2f(loc.seed, seedX, seedY);
      gl.uniform1i(loc.mode, mode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

function makeFallbackDataUrl(title = '山海新作') {
  const safe = String(title).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
    <rect width="800" height="500" fill="#f2ead4"/>
    <path d="M0 360 Q220 260 440 340 T800 300 L800 500 L0 500 Z" fill="#365f58" opacity="0.24"/>
    <path d="M0 410 Q280 330 560 400 T800 370 L800 500 L0 500 Z" fill="#855443" opacity="0.32"/>
    <text x="56" y="88" font-family="serif" font-size="32" fill="#2d3b32">${safe}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function makeContainedBuffer(img, w, h, monochrome = false) {
  const buf = document.createElement('canvas');
  buf.width = w;
  buf.height = h;
  const bCtx = buf.getContext('2d');
  bCtx.fillStyle = '#f3ebd4';
  bCtx.fillRect(0, 0, w, h);
  const iw = img.naturalWidth || 800;
  const ih = img.naturalHeight || 500;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  if (monochrome && typeof bCtx.filter === 'string') {
    bCtx.filter = 'grayscale(94%) contrast(1.08) brightness(1.03)';
  }
  bCtx.drawImage(img, 0, 0, iw, ih, dx, dy, dw, dh);
  bCtx.filter = 'none';
  return buf;
}

function hashSeed(str, fallback) {
  let h = fallback;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 997;
  return (h % 19) * 0.89;
}

function formatToolName(tool) {
  if (!tool) return '文心一言';
  if (typeof tool === 'string') return tool;
  return tool.name || '文心一言';
}

export function createGalleryAtelier({
  canvas,
  collectionNotebook,
  message,
  dialog,
  fixedActivityId = null,
  allowCollect = true,
  promptTitle = '创作提示词笺',
  emptyLines = null,
  autoplayPausedByDefault = false,
}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shaderEngine = createInkShaderEngine();
  const loadedImages = new Map();

  let classes = [];
  let activities = [];
  let activeActivityId = fixedActivityId || 'lesson-9-task-1';
  let activeClassId = null;
  let entries = [];
  let offset = 0;
  let hasMore = false;
  let currentIndex = 0;
  let autoplayPaused = Boolean(autoplayPausedByDefault);
  let animId = null;
  let transitionToken = 0;
  let requestToken = 0;
  let seedStep = 0;
  let destroyed = false;

  const root = el('section', undefined, 'creation-atelier');
  if (autoplayPaused) root.classList.add('is-paused');

  // 上方：作品标题、班级与作者、帧计及任务/班级切换条
  const topBar = el('div', undefined, 'atelier-top');
  const titleBlock = el('div', undefined, 'atelier-title-block');
  const titleEl = el('h3', '', 'atelier-title');
  const bylineEl = el('span', '', 'atelier-byline');
  const indexEl = el('span', '', 'atelier-index');
  titleBlock.append(titleEl, bylineEl, indexEl);

  const controlsRight = el('div', undefined, 'atelier-top-controls');
  const activityTabsEl = el('div', undefined, 'atelier-class-tabs atelier-activity-tabs');
  activityTabsEl.setAttribute('role', 'group');
  activityTabsEl.setAttribute('aria-label', '按任务筛选作品');
  const classTabsEl = el('div', undefined, 'atelier-class-tabs');
  classTabsEl.setAttribute('role', 'group');
  classTabsEl.setAttribute('aria-label', '按班级筛选作品');
  const autoplayBtn = el('button', autoplayPaused ? '开启自动切画' : '暂停自动切画', 'atelier-toggle-btn');
  autoplayBtn.type = 'button';
  autoplayBtn.setAttribute('aria-pressed', String(!autoplayPaused));
  controlsRight.append(activityTabsEl, classTabsEl, autoplayBtn);
  topBar.append(titleBlock, controlsRight);

  // 空展提示区
  const emptyState = el('div', undefined, 'atelier-empty');
  emptyState.hidden = true;
  const defaultEmptyLines = [
    '教师审核通过并发布同学作品后，将在这里按宣纸画卷形式展出。',
    '你也可以先打开右上角“我的提示词收藏本”，记下自己的山海创作灵感。',
  ];
  for (const line of emptyLines || defaultEmptyLines) {
    emptyState.append(el('p', line));
  }

  // 主体双栏：左宣纸画框 + 右朱丝栏词笺
  const grid = el('div', undefined, 'atelier-grid');
  const stageCol = el('div', undefined, 'atelier-stage-col');
  const stageFrame = el('div', undefined, 'atelier-stage-frame');
  const stageCorners = el('div', undefined, 'atelier-stage-corners');
  stageCorners.setAttribute('aria-hidden', 'true');
  const stageBox = el('div', undefined, 'atelier-stage-box');
  const stageLink = el('a', undefined, 'atelier-stage-link');
  stageLink.target = '_blank';
  stageLink.rel = 'noopener noreferrer';
  const stageImg = el('img', undefined, 'atelier-stage-img');
  stageLink.append(stageImg);

  const inkCanvas = document.createElement('canvas');
  inkCanvas.className = 'atelier-stage-canvas';
  inkCanvas.setAttribute('aria-hidden', 'true');
  const ctx = inkCanvas.getContext('2d');

  const sealEl = el('span', '山海新作', 'atelier-stage-seal');
  const prevBtn = el('button', '‹', 'atelier-nav atelier-prev');
  prevBtn.type = 'button';
  prevBtn.setAttribute('aria-label', '上一幅作品');
  const nextBtn = el('button', '›', 'atelier-nav atelier-next');
  nextBtn.type = 'button';
  nextBtn.setAttribute('aria-label', '下一幅作品');

  stageBox.append(stageLink, inkCanvas, sealEl, prevBtn, nextBtn);
  stageFrame.append(stageCorners, stageBox);
  stageCol.append(stageFrame);

  // 右侧：创作提示词笺
  const aside = el('aside', undefined, 'atelier-prompt-aside');
  const promptCard = el('div', undefined, 'atelier-prompt-card');
  const promptHead = el('div', undefined, 'atelier-prompt-head');
  const promptHeadTitle = el('span', undefined, 'atelier-prompt-head-title');
  const miniSeal = el('span', '词', 'atelier-mini-seal');
  miniSeal.setAttribute('aria-hidden', 'true');
  promptHeadTitle.append(miniSeal, el('span', promptTitle));
  const toolEl = el('span', '', 'atelier-tool-tag');
  promptHead.append(promptHeadTitle, toolEl);

  const promptEl = el('p', '', 'atelier-prompt-text');
  const tipEl = el('p', '可用鼠标拖选上方精彩描写只收所选句段；悬停词笺时自动切画会停驻。', 'atelier-prompt-tip');
  tipEl.hidden = !allowCollect;

  const actions = el('div', undefined, 'atelier-actions');
  const collectBtn = el('button', '收藏整段提示词', 'is-primary');
  collectBtn.type = 'button';
  collectBtn.hidden = !allowCollect;
  const copyBtn = el('button', allowCollect ? '复制提示词' : '复制这段原文');
  copyBtn.type = 'button';
  actions.append(collectBtn, copyBtn);

  promptCard.append(promptHead, promptEl, tipEl, actions);
  aside.append(promptCard);
  grid.append(stageCol, aside);

  // 下方：缩略图条 + 加载更多
  const thumbsWrap = el('div', undefined, 'atelier-thumbs-wrap');
  const thumbsList = el('ul', undefined, 'atelier-thumbs');
  const moreBtn = el('button', '查看更多作品', 'atelier-more-btn');
  moreBtn.type = 'button';
  moreBtn.hidden = true;
  thumbsWrap.append(thumbsList, moreBtn);

  root.append(topBar, emptyState, grid, thumbsWrap);
  canvas.replaceChildren(root);

  function workImageUrl(work) {
    return `/api/creation/media/${work.media_id}`;
  }

  function workThumbUrl(work) {
    return `/api/creation/media/${work.media_id}/thumbnail`;
  }

  function preloadWorkImage(work) {
    const key = work.media_id || work.id;
    if (loadedImages.has(key)) return Promise.resolve(loadedImages.get(key));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        loadedImages.set(key, img);
        resolve(img);
      };
      img.onerror = () => {
        const fb = new Image();
        fb.onload = () => resolve(fb);
        fb.src = makeFallbackDataUrl(work.title);
      };
      img.src = workImageUrl(work);
    });
  }

  function syncCanvasSize() {
    const rect = stageBox.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    inkCanvas.width = Math.max(1, Math.round(w * dpr));
    inkCanvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  function playInkTransition(fromWork, toWork, direction = 1) {
    if (animId) cancelAnimationFrame(animId);
    const token = ++transitionToken;
    if (reducedMotion || !fromWork || fromWork.id === toWork.id) {
      preloadWorkImage(toWork).then((img) => {
        if (destroyed || token !== transitionToken) return;
        stageImg.src = img.src;
        stageImg.style.opacity = '1';
      });
      return;
    }

    Promise.all([preloadWorkImage(fromWork), preloadWorkImage(toWork)]).then(([fromImg, toImg]) => {
      if (destroyed || token !== transitionToken) return;
      const { w, h } = syncCanvasSize();
      const bw = Math.max(1, Math.round(w));
      const bh = Math.max(1, Math.round(h));
      const dprScale = Math.min(window.devicePixelRatio || 1, 1.5);
      const gw = Math.max(1, Math.round(w * dprScale));
      const gh = Math.max(1, Math.round(h * dprScale));

      const fromColorBuf = makeContainedBuffer(fromImg, bw, bh, false);
      const fromMonoBuf = makeContainedBuffer(fromImg, bw, bh, true);
      const toMonoBuf = makeContainedBuffer(toImg, bw, bh, true);
      const toColorBuf = makeContainedBuffer(toImg, bw, bh, false);

      const layerBuf = document.createElement('canvas');
      layerBuf.width = bw;
      layerBuf.height = bh;
      const lCtx = layerBuf.getContext('2d');

      function drawMaskedLayer(mode, srcCanvas, t, seedX, seedY, alpha = 1) {
        shaderEngine.renderMask(gw, gh, t, direction, w / h, seedX, seedY, mode);
        lCtx.globalCompositeOperation = 'source-over';
        lCtx.clearRect(0, 0, bw, bh);
        lCtx.drawImage(shaderEngine.canvas, 0, 0, bw, bh);
        lCtx.globalCompositeOperation = 'source-in';
        lCtx.drawImage(srcCanvas, 0, 0, bw, bh);
        if (alpha !== 1) {
          ctx.save();
          ctx.globalAlpha = alpha;
        }
        ctx.drawImage(layerBuf, 0, 0, w, h);
        if (alpha !== 1) ctx.restore();
      }

      seedStep += 1;
      const seedX = (seedStep * 1.73 + hashSeed(String(fromWork.id), 3)) % 19.0;
      const seedY = (seedStep * 2.41 + hashSeed(String(toWork.title || ''), 7)) % 17.0;
      const totalDuration = 3200;
      const start = performance.now();

      stageImg.src = toImg.src;
      stageImg.style.opacity = '0';

      function step(now) {
        if (destroyed || token !== transitionToken) return;
        const t = Math.min(1, (now - start) / totalDuration);

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#f3ebd4';
        ctx.fillRect(0, 0, w, h);

        if (shaderEngine) {
          drawMaskedLayer(1, fromMonoBuf, t, seedX, seedY, 0.86);
          drawMaskedLayer(0, fromColorBuf, t, seedX, seedY, 1);
          drawMaskedLayer(2, toMonoBuf, t, seedX, seedY, 0.78);
          drawMaskedLayer(3, toColorBuf, t, seedX, seedY, 1);
          shaderEngine.renderMask(gw, gh, t, direction, w / h, seedX, seedY, 4);
          ctx.drawImage(shaderEngine.canvas, 0, 0, w, h);
        } else {
          const ease = t * t * (3 - 2 * t);
          ctx.save();
          ctx.globalAlpha = 1 - ease;
          ctx.drawImage(fromColorBuf, 0, 0, w, h);
          ctx.globalAlpha = ease;
          ctx.drawImage(toColorBuf, 0, 0, w, h);
          ctx.restore();
        }

        if (t < 1) {
          animId = requestAnimationFrame(step);
        } else {
          ctx.clearRect(0, 0, w, h);
          stageImg.style.opacity = '1';
          animId = null;
        }
      }

      step(start);
      animId = requestAnimationFrame(step);
    });
  }

  function renderActivityTabs() {
    activityTabsEl.replaceChildren();
    if (fixedActivityId) {
      activityTabsEl.hidden = true;
      return;
    }
    activityTabsEl.hidden = !activities.length;
    if (!activities.length) return;
    activityTabsEl.append(el('span', '展览单元：', 'atelier-class-label'));
    const options = activities.length > 1 ? [...activities, { id: null, label: '全部作品' }] : activities;
    for (const item of options) {
      const btn = el('button', item.label, 'atelier-class-tab');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(item.id === activeActivityId));
      btn.addEventListener('click', () => selectActivity(item.id));
      activityTabsEl.append(btn);
    }
  }

  function renderClassTabs() {
    classTabsEl.replaceChildren();
    classTabsEl.hidden = !classes.length;
    if (!classes.length) return;
    const label = el('span', '同赏班级：', 'atelier-class-label');
    classTabsEl.append(label);

    const options = [{ id: null, name: '全部班级' }, ...classes];
    for (const cls of options) {
      const btn = el('button', cls.name, 'atelier-class-tab');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(cls.id === activeClassId));
      btn.addEventListener('click', () => selectClass(cls.id));
      classTabsEl.append(btn);
    }
  }

  function renderThumbs() {
    thumbsList.replaceChildren();
    entries.forEach((work, idx) => {
      const li = el('li', undefined, 'atelier-thumb-item');
      const btn = el('button', undefined, 'atelier-thumb-btn');
      btn.type = 'button';
      btn.setAttribute('aria-current', String(idx === currentIndex));
      btn.setAttribute('aria-label', `查看 ${work.title}（${work.class_name} ${work.author}）`);

      const img = el('img');
      img.src = workThumbUrl(work);
      img.loading = 'lazy';
      img.alt = work.title;
      img.onerror = () => {
        img.src = makeFallbackDataUrl(work.title);
      };

      const cap = el('span', work.title, 'atelier-thumb-caption');
      const sub = el('span', `${work.class_name} · ${work.author}`, 'atelier-thumb-sub');
      btn.append(img, cap, sub);

      if (idx === currentIndex && !autoplayPaused && !reducedMotion && entries.length > 1) {
        const bar = el('span', undefined, 'atelier-thumb-progress');
        bar.setAttribute('aria-hidden', 'true');
        bar.addEventListener('animationend', () => goTo(currentIndex + 1, 1));
        btn.append(bar);
      }

      btn.addEventListener('click', () => {
        const dir = idx >= currentIndex ? 1 : -1;
        goTo(idx, dir);
      });
      li.append(btn);
      thumbsList.append(li);
    });

    const single = entries.length <= 1;
    prevBtn.hidden = single;
    nextBtn.hidden = single;
    autoplayBtn.hidden = single;
    moreBtn.hidden = !hasMore;
  }

  function syncWorkView() {
    const hasEntries = entries.length > 0;
    emptyState.hidden = hasEntries;
    grid.hidden = !hasEntries;
    thumbsWrap.hidden = !hasEntries;

    if (!hasEntries) {
      titleEl.textContent = '同学的山海新作';
      bylineEl.hidden = true;
      indexEl.textContent = '';
      autoplayBtn.hidden = true;
      return;
    }

    const work = entries[currentIndex];
    const toolName = formatToolName(work.tool);
    titleEl.textContent = work.title;
    bylineEl.hidden = false;
    bylineEl.textContent = `${work.class_name} · ${work.author}`;
    indexEl.textContent = `第 ${String(currentIndex + 1).padStart(2, '0')} / ${String(entries.length).padStart(2, '0')} 帧`;
    sealEl.textContent = toolName;
    toolEl.textContent = `生成工具：${toolName}`;
    promptEl.textContent = work.prompt;
    stageLink.href = workImageUrl(work);
    stageLink.setAttribute('aria-label', `在新窗口查看原图：${work.title}`);
    stageImg.alt = `${work.title}（${work.class_name} ${work.author}）`;
    collectBtn.textContent = '收藏整段提示词';
    renderThumbs();
  }

  function goTo(nextIdx, direction = 1) {
    if (!entries.length) return;
    const targetIdx = (nextIdx + entries.length) % entries.length;
    if (targetIdx === currentIndex) return;
    const fromWork = entries[currentIndex];
    currentIndex = targetIdx;
    syncWorkView();
    playInkTransition(fromWork, entries[currentIndex], direction);
  }

  async function fetchGalleryPage({ activityId, classId, nextOffset, append }) {
    const req = ++requestToken;
    const query = new URLSearchParams({ offset: String(nextOffset) });
    if (activityId) query.set('activity_id', activityId);
    if (classId !== null) query.set('class_id', String(classId));
    const result = await api(`/api/creation/gallery?${query.toString()}`);
    if (destroyed || req !== requestToken) return null;

    if (Array.isArray(result.activities)) activities = result.activities;
    if (Array.isArray(result.classes)) classes = result.classes;
    const incoming = result.entries || [];
    const prevWork = entries[currentIndex];

    if (append) {
      entries = entries.concat(incoming);
      offset += incoming.length;
    } else {
      entries = incoming;
      offset = incoming.length;
      currentIndex = 0;
    }
    hasMore = incoming.length >= 24;
    renderActivityTabs();
    renderClassTabs();
    syncWorkView();

    if (!append && entries.length) {
      if (prevWork && prevWork.id !== entries[0].id) {
        playInkTransition(prevWork, entries[0], 1);
      } else {
        const img = await preloadWorkImage(entries[0]);
        if (!destroyed && req === requestToken) {
          stageImg.src = img.src;
          stageImg.style.opacity = '1';
        }
      }
    }
    return result;
  }

  async function selectActivity(activityId) {
    if (activityId === activeActivityId) return;
    activeActivityId = activityId;
    activeClassId = null;
    renderActivityTabs();
    renderClassTabs();
    try {
      await fetchGalleryPage({ activityId, classId: activeClassId, nextOffset: 0, append: false });
    } catch (err) {
      message.textContent = err.message;
    }
  }

  async function selectClass(classId) {
    if (classId === activeClassId) return;
    activeClassId = classId;
    renderClassTabs();
    try {
      await fetchGalleryPage({ activityId: activeActivityId, classId, nextOffset: 0, append: false });
    } catch (err) {
      message.textContent = err.message;
    }
  }

  const onSelectionChange = () => {
    if (!allowCollect) return;
    const sel = window.getSelection();
    if (sel && promptEl.contains(sel.anchorNode) && promptEl.contains(sel.focusNode) && sel.toString().trim()) {
      collectBtn.textContent = '收藏所选句段';
    } else {
      collectBtn.textContent = '收藏整段提示词';
    }
  };

  const onKeyDown = (event) => {
    if (destroyed || !entries.length) return;
    const activeTag = document.activeElement?.tagName;
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
    if (dialog?.querySelector('#learning-note:not([hidden])')) return;
    if (event.key === 'ArrowLeft') goTo(currentIndex - 1, -1);
    else if (event.key === 'ArrowRight') goTo(currentIndex + 1, 1);
  };

  const onResize = () => {
    if (!destroyed && !animId && entries.length) syncCanvasSize();
  };

  prevBtn.addEventListener('click', () => goTo(currentIndex - 1, -1));
  nextBtn.addEventListener('click', () => goTo(currentIndex + 1, 1));
  autoplayBtn.addEventListener('click', () => {
    autoplayPaused = !autoplayPaused;
    root.classList.toggle('is-paused', autoplayPaused);
    autoplayBtn.setAttribute('aria-pressed', String(!autoplayPaused));
    autoplayBtn.textContent = autoplayPaused ? '开启自动切画' : '暂停自动切画';
    renderThumbs();
  });

  collectBtn.addEventListener('click', async () => {
    if (!allowCollect || !collectionNotebook || !entries.length) return;
    const work = entries[currentIndex];
    const sel = window.getSelection();
    const excerpt =
      sel && promptEl.contains(sel.anchorNode) && promptEl.contains(sel.focusNode) ? sel.toString().trim() : '';
    const content = excerpt || work.prompt;
    collectBtn.disabled = true;
    try {
      await collectionNotebook.collect(work, content);
      message.textContent = excerpt ? '已将选中的句段收入提示词收藏本。' : '已将整段提示词收入提示词收藏本。';
    } catch (err) {
      message.textContent = err.message;
    } finally {
      collectBtn.disabled = false;
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!entries.length) return;
    try {
      await copy(entries[currentIndex].prompt);
      message.textContent = '已复制这段提示词。';
    } catch {
      message.textContent = '当前环境不支持自动剪贴板，请直接拖选文字复制。';
    }
  });

  moreBtn.addEventListener('click', async () => {
    moreBtn.disabled = true;
    try {
      await fetchGalleryPage({ activityId: activeActivityId, classId: activeClassId, nextOffset: offset, append: true });
    } catch (err) {
      message.textContent = err.message;
    } finally {
      moreBtn.disabled = false;
    }
  });

  document.addEventListener('selectionchange', onSelectionChange);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  return {
    async init() {
      await fetchGalleryPage({ activityId: activeActivityId, classId: null, nextOffset: 0, append: false });
      if (!destroyed && !entries.length && activities.length) {
        activeActivityId = activities[0].id;
        await fetchGalleryPage({ activityId: activeActivityId, classId: null, nextOffset: 0, append: false });
      }
      entries.slice(1, 5).forEach(preloadWorkImage);
    },
    destroy() {
      destroyed = true;
      ++transitionToken;
      ++requestToken;
      if (animId) cancelAnimationFrame(animId);
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      shaderEngine?.dispose();
    },
  };
}
