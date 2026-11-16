/* 四邻居比较 → 两项灰度差 → 合成梯度。只显示真正计算过的位置。 */
import { gradientAt } from "./model.mjs";

const MANUAL_TARGET = 3;
const AUTO_DURATION = 30000;
const ORANGE = "#b45a25",
  HORIZONTAL = "#26708b",
  VERTICAL = "#466c32";

export function mountHogPixels(root, onChange = () => {}) {
  const ui = (name) => root.querySelector(`[data-hog-pixel-ui="${name}"]`);
  const source = root.querySelector('[data-hog-pixel-canvas="source"]');
  const result = root.querySelector('[data-hog-pixel-canvas="directions"]');
  const action = (name) =>
    root.querySelector(`[data-hog-pixel-action="${name}"]`);
  const locksEnabled =
    document.querySelector('meta[name="progress-locks-enabled"]')?.content !==
    "false";
  let picture,
    x = 6,
    y = 12,
    compared = {},
    revealed = false,
    marked,
    manual = new Set();
  let feedback = "",
    timer = null,
    playing = false,
    sweep = null;
  let remaining = 0,
    due = 0;
  const at = (px, py) =>
    picture.values[
      Math.max(0, Math.min(picture.height - 1, py)) * picture.width +
        Math.max(0, Math.min(picture.width - 1, px))
    ];
  const index = () => y * picture.width + x;

  // 屏幕纵轴向下；算法gy采用上−下，绘制时取负号。
  function arrow(ctx, cx, cy, radius, g) {
    if (!g.magnitude) {
      ctx.fillStyle = "#718276";
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, radius * 0.12), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(-g.gy, g.gx));
    ctx.strokeStyle = "#365f58";
    ctx.lineWidth = Math.max(1, radius * 0.14);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.lineTo(radius * 0.45, -radius * 0.45);
    ctx.moveTo(radius, 0);
    ctx.lineTo(radius * 0.45, radius * 0.45);
    ctx.stroke();
    ctx.restore();
  }

  function drawPictures() {
    for (const [canvas, isResult] of [
      [source, false],
      [result, true],
    ]) {
      const ctx = canvas.getContext("2d"),
        unit = canvas.width / picture.width;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f4f3ea";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      picture.values.forEach((v, i) => {
        const px = i % picture.width,
          py = Math.floor(i / picture.width);
        if (!isResult) {
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(px * unit, py * unit, unit + 0.1, unit + 0.1);
        } else if (marked[i])
          arrow(
            ctx,
            (px + 0.5) * unit,
            (py + 0.5) * unit,
            unit * 0.34,
            gradientAt(picture, px, py),
          );
      });
      ctx.strokeStyle = "#365f5828";
      ctx.lineWidth = 0.6;
      for (let n = 0; n <= picture.width; n++) {
        ctx.beginPath();
        ctx.moveTo(n * unit, 0);
        ctx.lineTo(n * unit, canvas.height);
        ctx.stroke();
      }
      for (let n = 0; n <= picture.height; n++) {
        ctx.beginPath();
        ctx.moveTo(0, n * unit);
        ctx.lineTo(canvas.width, n * unit);
        ctx.stroke();
      }
      // 原图标记与中间十字布局同色、同位置。
      if (!isResult)
        for (const [dx, dy, color] of [
          [-1, 0, HORIZONTAL],
          [1, 0, HORIZONTAL],
          [0, -1, VERTICAL],
          [0, 1, VERTICAL],
        ]) {
          const px = Math.max(0, Math.min(picture.width - 1, x + dx)),
            py = Math.max(0, Math.min(picture.height - 1, y + dy));
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(px * unit + 1, py * unit + 1, unit - 2, unit - 2);
        }
      ctx.strokeStyle = ORANGE;
      ctx.lineWidth = 3;
      ctx.strokeRect(x * unit + 1.5, y * unit + 1.5, unit - 3, unit - 3);
    }
  }

  function combination(g) {
    if (!g.magnitude)
      return '<svg viewBox="0 0 100 100" aria-label="变化强度为0，没有方向"><circle cx="50" cy="50" r="6" fill="#718276"/></svg>';
    const scale = 31 / Math.max(Math.abs(g.gx), Math.abs(g.gy)),
      dx = g.gx * scale,
      dy = -g.gy * scale,
      a = (Math.atan2(dy, dx) * 180) / Math.PI;
    return `<svg viewBox="0 0 100 100" role="img" aria-label="左右变化与上下变化合成的梯度箭头"><path d="M50 50h${dx}" stroke="${HORIZONTAL}" stroke-width="4"/><path d="M${50 + dx} 50v${dy}" stroke="${VERTICAL}" stroke-width="4"/><g transform="translate(50 50) rotate(${a})"><path d="M0 0H${Math.hypot(dx, dy)}m-9-6 9 6-9 6" fill="none" stroke="${ORANGE}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  }

  function equation(axis, g) {
    if (!revealed)
      return axis === "horizontal" ? "右 − 左 ＝ ？" : "上 − 下 ＝ ？";
    const horizontal = axis === "horizontal",
      diff = horizontal ? g.gx : g.gy;
    const first = horizontal ? at(x + 1, y) : at(x, y - 1),
      second = horizontal ? at(x - 1, y) : at(x, y + 1);
    const direction = !diff
      ? "两边一样亮"
      : horizontal
        ? diff > 0
          ? "→ 向右变亮"
          : "← 向左变亮"
        : diff > 0
          ? "↑ 向上变亮"
          : "↓ 向下变亮";
    return `${horizontal ? "右 − 左" : "上 − 下"}：${first} − ${second} ＝ ${diff}　${direction}`;
  }

  function render() {
    onChange();
    if (!picture) return;
    const g = gradientAt(picture, x, y),
      complete = revealed;
    drawPictures();
    ui("position").textContent = `第${x + 1}列 · 第${y + 1}行`;
    const cells = [];
    for (const [side, label, dx, dy, axis] of [
      ["up", "↑ 上", 0, -1, "vertical"],
      ["left", "← 左", -1, 0, "horizontal"],
      ["right", "右 →", 1, 0, "horizontal"],
      ["down", "↓ 下", 0, 1, "vertical"],
    ]) {
      const v = at(x + dx, y + dy),
        cell = document.createElement("button");
      cell.type = "button";
      cell.disabled = playing;
      const selected = compared[axis] === side || compared[axis] === "equal";
      cell.setAttribute("aria-pressed", String(selected));
      cell.setAttribute("aria-label", `${label}，灰度${v}`);
      cell.addEventListener("click", () => compare(axis, side));
      cell.className = `hog-neighbor is-${side}${selected ? " is-selected" : ""}`;
      cell.dataset.hogNeighbor = side;
      const name = document.createElement("strong");
      name.textContent = label;
      const value = document.createElement("span");
      value.textContent = String(v);
      value.style.background = `rgb(${v},${v},${v})`;
      value.style.color = v > 140 ? "#263d35" : "#fffbed";
      cell.append(name, value);
      cells.push(cell);
    }
    const center = document.createElement("div");
    center.className = "hog-cross-center";
    center.innerHTML = complete ? combination(g) : "<span>选中<br>像素</span>";
    cells.push(center);
    ui("neighbors").replaceChildren(...cells);
    for (const axis of ["horizontal", "vertical"]) {
      ui(axis).textContent = equation(axis, g);
    }
    root.querySelectorAll("[data-hog-pixel-compare]").forEach((button) => {
      const [axis, value] = button.dataset.hogPixelCompare.split(":");
      button.disabled = playing;
      button.setAttribute("aria-pressed", String(compared[axis] === value));
    });
    ui("calculation").hidden = !revealed;
    ui("vector").innerHTML = revealed ? combination(g) : "";
    const angle = ((Math.atan2(g.gy, g.gx) * 180) / Math.PI + 360) % 360;
    ui("angle").textContent = g.magnitude
      ? `方向：${angle.toFixed(1)}°`
      : "方向：无";
    ui("strength").textContent = `强度：${g.magnitude.toFixed(1)}`;
    action("mark").disabled =
      playing ||
      !Object.hasOwn(compared, "horizontal") ||
      !Object.hasOwn(compared, "vertical");
    const count = marked.reduce((sum, v) => sum + v, 0);
    ui("count").textContent = `${count} / ${marked.length}`;
    action("auto").disabled =
      count === marked.length || (locksEnabled && manual.size < MANUAL_TARGET);
    action("auto").textContent = playing
      ? "暂停演示"
      : sweep
        ? "继续演示"
        : "自动演示";
    action("auto").title =
      locksEnabled && manual.size < MANUAL_TARGET ? "先标记3个不同像素" : "";
    ui("feedback").textContent = feedback;
    ui("playback").textContent = playing
      ? `第${x + 1}列 · 第${y + 1}行`
      : sweep
        ? "已暂停"
        : count === marked.length
          ? "整图计算完成"
          : "";
  }

  function pause() {
    if (!playing) return;
    remaining = Math.max(0, due - performance.now());
    clearTimeout(timer);
    timer = null;
    playing = false;
    render();
  }
  function select(px, py) {
    pause();
    sweep = null;
    x = Math.max(0, Math.min(picture.width - 1, px));
    y = Math.max(0, Math.min(picture.height - 1, py));
    compared = {};
    revealed = false;
    feedback = "";
    render();
  }
  function compare(axis, value) {
    if (playing) return;
    // 标记只记录学生选择；点击手动运算后才显示真实算式与结果。
    compared[axis] = value;
    revealed = false;
    feedback = "";
    render();
  }

  // 每次只计算一个像素；左右选点、四邻居、算式与输出同步推进。
  function applySweepFrame() {
    const current = sweep.indices[sweep.cursor];
    x = current % picture.width;
    y = Math.floor(current / picture.width);
    const g = gradientAt(picture, x, y);
    compared = {
      horizontal: !g.gx ? "equal" : g.gx > 0 ? "right" : "left",
      vertical: !g.gy ? "equal" : g.gy > 0 ? "up" : "down",
    };
    marked[current] = 1;
    revealed = true;
    feedback = "";
    render();
  }

  function schedule(delay) {
    due = performance.now() + delay;
    timer = setTimeout(() => {
      if (!playing) return;
      sweep.cursor++;
      if (sweep.cursor === sweep.indices.length) {
        playing = false;
        sweep = null;
        timer = null;
        feedback = "";
        render();
        return;
      }
      // 使用目标时刻扣除本帧计算时间，避免像素增多后演示越来越慢。
      const nextDue = due + sweep.interval;
      applySweepFrame();
      schedule(Math.max(0, nextDue - performance.now()));
    }, delay);
  }

  function autoplay() {
    if (playing) {
      pause();
      return;
    }
    if (action("auto").disabled) return;
    if (!sweep) {
      const indices = Array.from({ length: marked.length }, (_, i) => i).filter(
        (i) => !marked[i],
      );
      if (!indices.length) return;
      sweep = { indices, cursor: 0, interval: AUTO_DURATION / indices.length };
      remaining = sweep.interval;
      playing = true;
      applySweepFrame();
    } else playing = true;
    render();
    schedule(remaining);
  }

  for (const canvas of [source, result]) {
    canvas.addEventListener("click", (event) => {
      const box = canvas.getBoundingClientRect();
      select(
        Math.floor(((event.clientX - box.left) / box.width) * picture.width),
        Math.floor(((event.clientY - box.top) / box.height) * picture.height),
      );
    });
    canvas.addEventListener("keydown", (event) => {
      const delta = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }[event.key];
      if (!delta) return;
      event.preventDefault();
      select(x + delta[0], y + delta[1]);
    });
  }
  root
    .querySelectorAll("[data-hog-pixel-compare]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        compare(...button.dataset.hogPixelCompare.split(":")),
      ),
    );
  action("mark").addEventListener("click", () => {
    if (action("mark").disabled) return;
    marked[index()] = 1;
    revealed = true;
    manual.add(index());
    const g = gradientAt(picture, x, y);
    const horizontal = !g.gx ? "equal" : g.gx > 0 ? "right" : "left";
    const vertical = !g.gy ? "equal" : g.gy > 0 ? "up" : "down";
    const correct =
      compared.horizontal === horizontal && compared.vertical === vertical;
    feedback = !correct
      ? "对照灰度值检查标记；算式与箭头按实际灰度计算。"
      : !g.magnitude
        ? "两项差都是0：没有方向，在右图记一个点。"
        : "";
    render();
  });
  action("auto").addEventListener("click", autoplay);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  return {
    refresh(next) {
      if (next !== picture) {
        pause();
        picture = next;
        marked = new Uint8Array(picture.values.length);
        manual = new Set();
        sweep = null;
        compared = {};
        revealed = false;
        feedback = "";
        if (picture.width === 24) {
          x = 6;
          y = 12;
        } else {
          let best = -1;
          picture.values.forEach((_, i) => {
            const m = gradientAt(
              picture,
              i % picture.width,
              Math.floor(i / picture.width),
            ).magnitude;
            if (m > best) {
              best = m;
              x = i % picture.width;
              y = Math.floor(i / picture.width);
            }
          });
        }
      }
      render();
    },
    pause,
    selection: () => ({ x, y }),
    snapshot: expected => picture && picture === expected ? ({ x, y, compared, revealed, manual: [...manual], marked: Array.from(marked), sweep, remaining }) : null,
    restore(saved, next) {
      if (!saved || !Number.isInteger(saved.x) || !Number.isInteger(saved.y)
          || saved.x < 0 || saved.x >= next.width || saved.y < 0 || saved.y >= next.height
          || !Array.isArray(saved.marked) || saved.marked.length !== next.values.length) return;
      pause(); picture = next; x = saved.x; y = saved.y;
      compared = saved.compared || {}; revealed = saved.revealed === true;
      manual = new Set(saved.manual); marked = Uint8Array.from(saved.marked);
      sweep = saved.sweep; remaining = saved.remaining || 0;
    },
    reset() {
      pause();
      picture = null;
      sweep = null;
      manual = new Set();
      compared = {};
      revealed = false;
      feedback = "";
    },
  };
}
