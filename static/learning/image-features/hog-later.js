/* 区域大小探究与最终特征体验：每张图、每组数字都从相同灰度真实计算。 */
export { mountHogFinish } from "./hog-finish.js";
import { clampIntroShift } from "./hog-intro-model.mjs";
import { sizeComparison, sizeRecord } from "./hog-size-model.mjs";
import { hog } from "./model.mjs";

// 每格的短线来自真实方向统计；不保留这一格内边缘的具体位置。
function drawCellFeatures(canvas, image, size) {
  const c = canvas.getContext("2d"), d = hog(image, size);
  const unit = canvas.width / d.columns;
  const peak = Math.max(1, ...d.histograms.flat());
  c.fillStyle = "#f2f3e9";
  c.fillRect(0, 0, canvas.width, canvas.height);
  d.histograms.forEach((values, i) => {
    const x = (i % d.columns) * unit, y = Math.floor(i / d.columns) * unit;
    c.strokeStyle = "#365f5860";
    c.lineWidth = 1;
    c.strokeRect(x, y, unit, unit);
    values.forEach((v, b) => {
      if (!v) return;
      const angle = (b * 20 + 90) * Math.PI / 180;
      const r = unit * .42 * v / peak;
      c.strokeStyle = "#365f58";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + unit / 2 - Math.cos(angle) * r, y + unit / 2 + Math.sin(angle) * r);
      c.lineTo(x + unit / 2 + Math.cos(angle) * r, y + unit / 2 - Math.sin(angle) * r);
      c.stroke();
    });
  });
}

function draw(canvas, image, cellSize, block = null) {
  const c = canvas.getContext("2d"),
    u = canvas.width / image.width;
  image.values.forEach((v, i) => {
    c.fillStyle = `rgb(${v},${v},${v})`;
    c.fillRect(
      (i % image.width) * u,
      Math.floor(i / image.width) * u,
      u + 0.1,
      u + 0.1,
    );
  });
  for (const spacing of [1, cellSize]) {
    c.strokeStyle = spacing === 1 ? "#365f5825" : "#365f5890";
    c.lineWidth = spacing === 1 ? 0.5 : 1.5;
    for (let n = 0; n <= image.width; n += spacing) {
      c.beginPath();
      c.moveTo(n * u, 0);
      c.lineTo(n * u, canvas.height);
      c.stroke();
      c.beginPath();
      c.moveTo(0, n * u);
      c.lineTo(canvas.width, n * u);
      c.stroke();
    }
  }
  if (block) {
    c.strokeStyle = "#a85b32";
    c.lineWidth = 3;
    c.strokeRect(
      block.x * 8 * u + 1.5,
      block.y * 8 * u + 1.5,
      16 * u - 3,
      16 * u - 3,
    );
  }
}

export function mountHogSize(root) {
  const ui = (n) => root.querySelector('[data-hog-size-ui="' + n + '"]');
  const moving = ui("changed");
  let size = 8,
    showFeatures = false,
    dx = 0,
    dy = 0,
    drag = null,
    result = sizeComparison();
  // 第四步的位移与划分按学生隔离保存；不上传实验状态，不改札记或圈色。
  const studentId = root.dataset.studentId,
    activityId = "lesson-6-task-3";
  const storageKey = studentId
    ? "shanhai:experiment:" + studentId + ":" + activityId + ":cell-size"
    : null;
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          studentId,
          activityId,
          savedAt: new Date().toISOString(),
          state: { step: 3, size, dx, dy, showFeatures },
        }),
      );
    } catch {}
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }
  if (storageKey) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (
        saved?.version === 1 &&
        saved.studentId === studentId &&
        saved.activityId === activityId &&
        [4, 8, 16, 24].includes(saved.state?.size) &&
        Number.isInteger(saved.state.dx) &&
        Number.isInteger(saved.state.dy)
      ) {
        size = saved.state.size;
        showFeatures = saved.state.showFeatures === true;
        const shift = clampIntroShift(saved.state.dx, saved.state.dy);
        dx = shift.dx;
        dy = shift.dy;
        result = sizeComparison(dx, dy);
      }
    } catch {}
  }
  window.addEventListener("pagehide", () => {
    if (saveTimer !== null) save();
  });
  function render() {
    draw(ui("original"), result.original, size);
    if (showFeatures) drawCellFeatures(ui("original"), result.original, size);
    ui("features").setAttribute("aria-pressed", String(showFeatures));
    ui("features").textContent = showFeatures ? "返回原图" : "查看区域特征";
    draw(moving, result.changed, size);
    ui("summary").textContent = (48 / size) ** 2 + "个区域 × 每区9个数";
    const horizontal = dx ? (dx > 0 ? "右" : "左") + Math.abs(dx) + "像素" : "";
    const vertical = dy ? (dy > 0 ? "下" : "上") + Math.abs(dy) + "像素" : "";
    const directions = [horizontal, vertical].filter(Boolean);
    const lines = [];
    (directions.length ? directions : ['原位']).forEach((text, i) => {
      if (i) lines.push(document.createTextNode('\n'));
      const line = document.createElement('span');
      line.textContent = text;
      lines.push(line);
    });
    ui("offset").replaceChildren(...lines);
    ui("similarity").textContent = result.scores[size].toFixed(1) + "%";
    ui("current-size").textContent = size + "×" + size + " 划分";
    ui("home").disabled = !dx && !dy;
    ui("finding").textContent =
      "保持这次位移，依次切换四种划分，把相似程度记入札记。";
    root
      .querySelectorAll("[data-hog-size]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String(Number(b.dataset.hogSize) === size),
        ),
      );
  }
  function moveTo(x, y) {
    const next = clampIntroShift(x, y);
    if (next.dx === dx && next.dy === dy) return;
    dx = next.dx;
    dy = next.dy;
    result = sizeComparison(dx, dy);
    scheduleSave();
    render();
  }
  function endDrag() {
    if (drag || saveTimer !== null) save();
    if (drag && moving.hasPointerCapture(drag.id))
      moving.releasePointerCapture(drag.id);
    drag = null;
    moving.classList.remove("is-dragging");
  }
  moving.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || drag) return;
    e.preventDefault();
    moving.focus({ preventScroll: true });
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx,
      dy,
      unit: moving.getBoundingClientRect().width / 48,
    };
    moving.setPointerCapture(e.pointerId);
    moving.classList.add("is-dragging");
  });
  moving.addEventListener("pointermove", (e) => {
    if (drag && drag.id === e.pointerId)
      moveTo(
        drag.dx + (e.clientX - drag.x) / drag.unit,
        drag.dy + (e.clientY - drag.y) / drag.unit,
      );
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    moving.addEventListener(type, endDrag);
  moving.addEventListener("keydown", (e) => {
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[e.key];
    if (e.key === "Home") {
      e.preventDefault();
      moveTo(0, 0);
    } else if (delta) {
      e.preventDefault();
      moveTo(dx + delta[0], dy + delta[1]);
    }
  });
  ui("home").addEventListener("click", () => moveTo(0, 0));
  ui("features").addEventListener("click", () => {
    showFeatures = !showFeatures;
    scheduleSave();
    render();
  });
  root.querySelectorAll("[data-hog-size]").forEach((b) =>
    b.addEventListener("click", () => {
      size = Number(b.dataset.hogSize);
      scheduleSave();
      render();
    }),
  );
  return {
    refresh: render,
    pause: endDrag,
    record: () => sizeRecord(result),
    reset() {
      endDrag();
      size = 8;
      showFeatures = false;
      dx = 0;
      dy = 0;
      result = sizeComparison();
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        if (storageKey) localStorage.removeItem(storageKey);
      } catch {}
      render();
    },
  };
}

