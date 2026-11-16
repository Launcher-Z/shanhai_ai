/* 五步科普：用途 → 像素方向 → 区域数字 → 大小取舍 → 归一化与最终特征。 */
import { gradientAt, grayscale } from "./model.mjs";
import {
  teachingImage,
  histogramVotes,
  describe,
} from "./hog-model.mjs";

import { mountHogIntro } from "./hog-intro.js";
import { mountHogSize, mountHogFinish } from "./hog-later.js";
import { mountHogPixels } from "./hog-pixels.js";
import { createExperimentStorage } from '../experiment-storage.js';

const STEPS = [
  [
    "有了轮廓，为什么还要HOG？",
    "拖动小屋，比较两组相似程度。",
    "轮廓留下边缘；HOG把局部方向整理成可比较的数字特征。",
  ],
  [
    "一个像素，方向从哪里来？",
    "先手动比较四个邻居，再看整图怎样生成。",
    "比较上下左右的灰度，得到明暗变化的方向与强度。梯度方向与边缘走向垂直。",
  ],
  [
    "把一片变化，收进九根柱子",
    "逐点统计，观察柱子怎样增长。",
    "局部方向统计保留了方向和大致位置。",
  ],
  [
    "区域越大，越好吗？",
    "自由移动右图，保持位移，再比较四种划分。",
    "小区域保留更多位置细节；大区域更容易混淆内部布局。8×8是一种取舍。",
  ],
  [
    "何罗鱼，从图像到特征",
    "点击自动演示，跟着何罗鱼走完一次特征提取。",
    "图像可用按顺序排列的数字描述；取其中两个数，可以在平面坐标中标出一个点。",
  ],
];
const INK = "#365f58",
  ACCENT = "#a85b32";
// 灰度范围0—255，每个轴的差最多255；固定比例尺便于跨区域、跨图片比较。
const MAX_GRADIENT_MAGNITUDE = 255 * Math.SQRT2;
const number = (value) =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

function drawGray(canvas, picture) {
  const ctx = canvas.getContext("2d"),
    u = canvas.width / picture.width;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  picture.values.forEach((v, i) => {
    ctx.fillStyle = Array.isArray(v)
      ? `rgb(${v.join(",")})`
      : `rgb(${v},${v},${v})`;
    ctx.fillRect(
      (i % picture.width) * u,
      Math.floor(i / picture.width) * u,
      u + 0.2,
      u + 0.2,
    );
  });
}

function grid(canvas, gray, spacing = 8) {
  const ctx = canvas.getContext("2d"),
    u = canvas.width / gray.width;
  ctx.strokeStyle = "#365f5860";
  ctx.lineWidth = 1;
  for (let x = 0; x <= gray.width; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x * u, 0);
    ctx.lineTo(x * u, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= gray.height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y * u);
    ctx.lineTo(canvas.width, y * u);
    ctx.stroke();
  }
}

function outline(canvas, gray, x, y, width, height = width, color = ACCENT) {
  const ctx = canvas.getContext("2d"),
    u = canvas.width / gray.width;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(x * u + 1.5, y * u + 1.5, width * u - 3, height * u - 3);
}

function bars(
  target,
  values,
  max,
  { labels = true, active = -1, normalized = false } = {},
) {
  target.replaceChildren(
    ...values.map((v, i) => {
      const bar = document.createElement("div");
      bar.className = "hog-bar";
      if (i === active) bar.classList.add("is-active");
      if (!labels && i % 9 === 0) bar.classList.add("is-group-start");
      bar.style.setProperty("--height", `${max ? (v / max) * 100 : 0}%`);
      const text = document.createElement("span");
      text.textContent = normalized ? v.toFixed(2) : number(v);
      const track = document.createElement("div");
      track.className = "hog-bar-track";
      const fill = document.createElement("i");
      track.append(fill);
      bar.append(text, track);
      if (labels) {
        const label = document.createElement("small");
        label.textContent = `${i * 20}°`;
        bar.append(label);
      }
      bar.title = `${labels ? i * 20 + "°" : `单元格${Math.floor(i / 9) + 1}的${(i % 9) * 20}°`}：${v.toFixed(4)}`;
      return bar;
    }),
  );
}

export function mountImageHog(root, onStepChange = () => {}) {
  const ui = (name) => root.querySelector(`[data-hog-ui="${name}"]`);
  const canvas = (name) => root.querySelector(`[data-hog-canvas="${name}"]`);
  const button = (name) => root.querySelector(`[data-hog-action="${name}"]`);
  let storage;
  const introLab = mountHogIntro(root);
  const pixelLab = mountHogPixels(root, () => storage?.changed());
  const sizeLab = mountHogSize(root),
    finishLab = mountHogFinish(root);
  let step = 0,
    allowedSteps = null;
  let gray = teachingImage("house"),
    descriptor = describe(gray),
    sample = "house",
    x = 11,
    y = 12;
  let voteCell = 4,
    voteCount = 0;
  let timer = null, imageVersion = 0;
  let restoring = false;
  storage = createExperimentStorage(root, 'lesson-6-task-3', () => restoring ? null : ({
    step, sample, x, y, voteCell, voteCount,
    intro: introLab.snapshot(), pixels: pixelLab.snapshot(gray),
  }));
  const canEnter = (next) => !allowedSteps || allowedSteps.has(next);

  function pause() {
    pixelLab.pause();
    sizeLab.pause();
    finishLab.pause();
    clearInterval(timer);
    timer = null;
    button("vote-auto").textContent = "自动继续";
    if (!restoring) storage.flush();
  }

  function resetImage(next, name) {
    gray = next;
    descriptor = describe(gray);
    sample = name;
    x = Math.min(gray.width - 1, Math.floor(gray.width * 0.46));
    y = Math.floor(gray.height / 2);
    voteCell = Math.floor(y / 8) * descriptor.columns + Math.floor(x / 8);
    voteCount = 0;

    ui("status").textContent = "";
    render();
  }

  function showStep(next) {
    if (!canEnter(next) || next < 0 || next >= STEPS.length) return;
    pause();
    // 恢复素材时切步骤不取消读图；重选素材和整项重置仍使旧请求失效。
    if (!restoring) imageVersion++;
    step = next;
    // 统计接住刚才观察的像素所在区域，避免跳到另一处而丢失联系。
    if (next === 2 && root.dataset.hogStep === "1") {
      const selected = pixelLab.selection();
      const nextCell =
        Math.floor(selected.y / 8) * descriptor.columns +
        Math.floor(selected.x / 8);
      if (nextCell !== voteCell) voteCount = 0;
      voteCell = nextCell;
    }
    render();
    onStepChange(step);
  }

  function renderNavigation() {
    const [heading, intro, takeaway] = STEPS[step];
    ui("heading").textContent = heading;
    ui("intro").textContent = intro;
    ui("takeaway").textContent = takeaway;
    root.dataset.hogStep = String(step);
    const current = ["intro", "pixels", "histogram", "size", "finish"][step];
    root.querySelectorAll("[data-hog-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.hogPanel !== current;
    });
    root.querySelectorAll("[data-hog-step]").forEach((b) => {
      b.disabled = !canEnter(Number(b.dataset.hogStep));
      b.title = b.disabled ? "首次提交前面的札记后解锁" : "";
      if (Number(b.dataset.hogStep) === step)
        b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    root
      .querySelectorAll("[data-hog-sample]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.hogSample === sample)),
      );
    ui("toolbar").hidden = step === 0 || step >= 3;
    root.querySelectorAll("[data-hog-help-step]").forEach((item) => {
      item.hidden = Number(item.dataset.hogHelpStep) !== step;
    });
    ui("image-size").textContent = `${gray.width}×${gray.height} 像素`;
    ui("step-count").textContent = `0${step + 1} / 05`;
    button("previous").disabled = step === 0;
    button("next").textContent =
      step === 4
        ? "填写本段札记 →"
        : !canEnter(step + 1)
          ? "填写本段札记 →"
          : [
              "找像素的方向 →",
              "去统计方向 →",
              "比较区域大小 →",
              "组成最终特征 →",
            ][step];
  }

  function renderVotes() {
    if (!restoring) storage.changed();
    const votes = histogramVotes(gray, 8, voteCell, gradientAt),
      index = Math.max(0, voteCount - 1),
      current = votes[index];
    const partial = Array(9).fill(0);
    for (let i = 0; i < voteCount; i++)
      partial[votes[i].bin] += votes[i].magnitude;
    const source = canvas("vote-source");
    drawGray(source, gray);
    grid(source, gray, 1);
    grid(source, gray, 8);
    const cx = (voteCell % descriptor.columns) * 8,
      cy = Math.floor(voteCell / descriptor.columns) * 8;
    outline(source, gray, cx, cy, 8);
    if (voteCount) outline(source, gray, current.x, current.y, 1, 1, "#b34525");
    // 放大的区域保留真实灰度，只有已经统计的像素才出现箭头。
    const zoom = canvas("vote-cell"),
      ctx = zoom.getContext("2d"),
      unit = zoom.width / 8;
    votes.forEach((v, i) => {
      const value = gray.values[v.y * gray.width + v.x],
        px = (i % 8) * unit,
        py = Math.floor(i / 8) * unit;
      ctx.fillStyle = `rgb(${value},${value},${value})`;
      ctx.fillRect(px, py, unit, unit);
      ctx.strokeStyle = "#365f583b";
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, unit, unit);
      if (i >= voteCount) return;
      if (!v.magnitude) {
        ctx.fillStyle = "#d87838";
        ctx.beginPath();
        ctx.arc(px + unit / 2, py + unit / 2, 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // 箭身和箭头同时按真实幅值缩放，不逐区域拉伸，也不设置最短箭头。
      const length = (unit * 0.72 * v.magnitude) / MAX_GRADIENT_MAGNITUDE;
      const half = length / 2,
        head = length * 0.26;
      ctx.save();
      ctx.translate(px + unit / 2, py + unit / 2);
      ctx.rotate(Math.atan2(-v.gy, v.gx));
      ctx.strokeStyle = "#d87838";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-half, 0);
      ctx.lineTo(half, 0);
      ctx.lineTo(half - head, -head * 0.6);
      ctx.moveTo(half, 0);
      ctx.lineTo(half - head, head * 0.6);
      ctx.stroke();
      ctx.restore();
    });
    if (voteCount) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3;
      ctx.strokeRect(
        (index % 8) * unit + 1.5,
        Math.floor(index / 8) * unit + 1.5,
        unit - 3,
        unit - 3,
      );
    }
    ui("cell-position").textContent =
      `第${cx / 8 + 1}列 · 第${cy / 8 + 1}行区域`;
    ui("vote-coordinate").textContent = voteCount
      ? `第${current.x + 1}列 · 第${current.y + 1}行`
      : "先统计第一个像素";
    ui("vote-contribution").textContent = !voteCount
      ? "点击“统计一个像素”开始。"
      : current.magnitude
        ? `${current.angle.toFixed(1)}° → ${current.bin * 20}°组，增加 ${current.magnitude.toFixed(1)}`
        : "没有变化，增加0。";
    const numbers = ui("region-numbers");
    numbers.textContent =
      voteCount === 64
        ? "[" + partial.map((v) => v.toFixed(1)).join("， ") + "]"
        : "完成本区域后，九个统计数会出现在这里。";
    bars(
      ui("histogram"),
      partial,
      Math.max(1, ...descriptor.histograms[voteCell]),
      { active: voteCount && current.magnitude ? current.bin : -1 },
    );
    ui("vote-status").textContent =
      `已统计 ${voteCount} / 64 个像素${voteCount === 64 ? " · 完成，可换区比较" : ""}`;
    button("vote-one").disabled =
      button("vote-auto").disabled =
      button("vote-all").disabled =
        voteCount === 64;
  }

  function render() {
    if (!restoring) storage.changed();
    renderNavigation();
    if (step === 0) introLab.refresh();
    if (step === 1) pixelLab.refresh(gray);
    if (step === 2) renderVotes();
    if (step === 3) sizeLab.refresh();
    if (step === 4) finishLab.refresh();
  }

  // 同一个像素位置/区域位置由点击和键盘共同维护，键盘不会跨行绕回。
  function selectAt(name, px, py) {
    pause();
    if (name === "vote-source") {
      const next = Math.floor(py / 8) * descriptor.columns + Math.floor(px / 8);
      if (next !== voteCell) voteCount = 0;
      voteCell = next;
      renderVotes();
    }
  }
  for (const name of ["vote-source"]) {
    const c = canvas(name);
    c.addEventListener("click", (event) => {
      const rect = c.getBoundingClientRect();
      selectAt(
        name,
        Math.max(
          0,
          Math.min(
            gray.width - 1,
            Math.floor(((event.clientX - rect.left) / rect.width) * gray.width),
          ),
        ),
        Math.max(
          0,
          Math.min(
            gray.height - 1,
            Math.floor(
              ((event.clientY - rect.top) / rect.height) * gray.height,
            ),
          ),
        ),
      );
    });
    c.addEventListener("keydown", (event) => {
      const delta = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!delta) return;
      event.preventDefault();
      let px = x,
        py = y,
        stride = 1;
      if (name === "vote-source") {
        px = (voteCell % descriptor.columns) * 8;
        py = Math.floor(voteCell / descriptor.columns) * 8;
        stride = 8;
      }
      selectAt(
        name,
        Math.max(0, Math.min(gray.width - 1, px + delta[0] * stride)),
        Math.max(0, Math.min(gray.height - 1, py + delta[1] * stride)),
      );
    });
  }

  async function readPicture(src, size = 48) {
    const image = new Image();
    image.src = src;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    const scale = Math.min(
        size / image.naturalWidth,
        size / image.naturalHeight,
      ),
      w = image.naturalWidth * scale,
      h = image.naturalHeight * scale;
    ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
    const data = ctx.getImageData(0, 0, size, size).data,
      values = [];
    for (let i = 0; i < data.length; i += 4)
      values.push([data[i], data[i + 1], data[i + 2]]);
    return { width: size, height: size, values };
  }

  root
    .querySelectorAll("[data-hog-step]")
    .forEach((b) =>
      b.addEventListener("click", () => showStep(Number(b.dataset.hogStep))),
    );
  root.querySelectorAll("[data-hog-sample]").forEach((b) =>
    b.addEventListener("click", async () => {
      pause();
      const kind = b.dataset.hogSample,
        version = ++imageVersion;
      restoring = false;
      if (kind !== "fish") {
        resetImage(teachingImage(kind), kind);
        return;
      }
      ui("status").textContent = "正在读取何罗鱼…";
      try {
        const image = await readPicture(
          new URL("../../bestiary/heluo-fish.png", import.meta.url).href,
        );
        if (version === imageVersion) resetImage(grayscale(image), kind);
      } catch {
        if (version === imageVersion)
          ui("status").textContent = "图片无法读取，请换一张试验图。";
      }
    }),
  );
  root.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const action = target.dataset.hogAction;
    if (action === "vote-one") {
      pause();
      voteCount = Math.min(64, voteCount + 1);
      renderVotes();
    }
    if (action === "vote-auto") {
      if (timer) {
        pause();
        return;
      }
      if (voteCount === 64) return;
      button("vote-auto").textContent = "暂停统计";
      timer = setInterval(() => {
        voteCount++;
        renderVotes();
        if (voteCount === 64) pause();
      }, 180);
    }
    if (action === "vote-reset") {
      pause();
      voteCount = 0;
      renderVotes();
    }
    if (action === "vote-all") {
      pause();
      voteCount = 64;
      renderVotes();
    }
    if (action === "previous") showStep(step - 1);
    if (action === "next") {
      if (step === 4 || !canEnter(step + 1))
        root.dispatchEvent(
          new CustomEvent("worksheet:open", {
            bubbles: true,
            detail: { step },
          }),
        );
      else showStep(step + 1);
    }
  });
  // 切出标签页时停止逐点演示，避免学生回来时过程已经跳过。
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  const saved = storage.read();
  function restoreSaved() {
    x = Number.isInteger(saved.x) ? Math.max(0, Math.min(gray.width - 1, saved.x)) : x;
    y = Number.isInteger(saved.y) ? Math.max(0, Math.min(gray.height - 1, saved.y)) : y;
    voteCell = Number.isInteger(saved.voteCell) ? Math.max(0, Math.min(descriptor.histograms.length - 1, saved.voteCell)) : voteCell;
    voteCount = Number.isInteger(saved.voteCount) ? Math.max(0, Math.min(64, saved.voteCount)) : 0;
    introLab.restore(saved.intro);
    pixelLab.restore(saved.pixels, gray);
    restoring = false;
    render();
  }
  if (saved && Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= 4
      && ['house', 'horizontal', 'vertical', 'fish'].includes(saved.sample)) {
    restoring = true; step = saved.step; sample = saved.sample;
    if (sample === 'fish') {
      const version = ++imageVersion;
      readPicture(new URL('../../bestiary/heluo-fish.png', import.meta.url).href)
        .then(image => {
          if (version !== imageVersion) return;
          gray = grayscale(image); descriptor = describe(gray); restoreSaved();
        }).catch(() => {
          if (version !== imageVersion) return;
          restoring = false; sample = 'house'; render();
          ui('status').textContent = '上次的何罗鱼图片未能读取，请重新选择。';
        });
    } else {
      gray = teachingImage(sample); descriptor = describe(gray);
      try { restoreSaved(); } catch { restoring = false; pixelLab.reset(); }
    }
  }
  return {
    refresh: render,
    getStep: () => step,
    reset() {
      pause();
      // 取消未完成的异步读图，各子活动恢复初始体验，札记由外层独立保留。
      ++imageVersion;
      restoring = false;
      step = 0;
      introLab.reset();
      pixelLab.reset();
      sizeLab.reset();
      finishLab.reset();
      root.querySelectorAll("details").forEach((item) => {
        item.open = false;
      });
      resetImage(teachingImage("house"), "house");
      onStepChange(0);
      storage.clear();
    },
    experimentAnswers(step) { return step===3 ? {'size-movement-record':sizeLab.record()} : {}; },
    pause,
    goToStep: showStep,
    setGate(steps) {
      allowedSteps = steps ? new Set(steps) : null;
      if (!canEnter(step)) showStep(steps[0]);
      else render();
    },
  };
}
