/* 第一步自由挪动：形状不变，固定坐标上的像素值却发生变化。 */
import { clampIntroShift, introComparison } from './hog-intro-model.mjs';

function drawEdge(canvas, edge, comparison = null) {
  const ctx = canvas.getContext('2d'), unit = canvas.width / edge.width;
  ctx.imageSmoothingEnabled = false;
  edge.values.forEach((value, index) => {
    const changed = comparison && value !== comparison.values[index];
    ctx.fillStyle = changed ? '#a85b32' : value ? '#365f58' : '#f5f3e9';
    ctx.fillRect(index % edge.width * unit, Math.floor(index / edge.width) * unit, unit + .1, unit + .1);
  });
  // 网格留在固定坐标上，只有小屋移动，帮助学生观察像素位置的变化。
  ctx.strokeStyle = '#365f5818'; ctx.lineWidth = .6;
  for (let i = 0; i <= edge.width; i++) {
    ctx.beginPath(); ctx.moveTo(i * unit, 0); ctx.lineTo(i * unit, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * unit); ctx.lineTo(canvas.width, i * unit); ctx.stroke();
  }
}

export function mountHogIntro(root) {
  const panel = root.querySelector('[data-hog-panel="intro"]');
  const ui = name => panel.querySelector(`[data-hog-intro-ui="${name}"]`);
  const canvas = name => panel.querySelector(`[data-hog-intro-canvas="${name}"]`);
  const moving = canvas('shifted');
  let dx = 0, dy = 0, overlay = false, showFeatures = false, drag = null;

  function render() {
    const result = introComparison(dx, dy);
    drawEdge(canvas('original'), result.originalEdge);
    drawEdge(moving, result.shiftedEdge, overlay ? result.originalEdge : null);
    const horizontal = dx ? `${dx > 0 ? '右' : '左'}${Math.abs(dx)}格` : '';
    const vertical = dy ? `${dy > 0 ? '下' : '上'}${Math.abs(dy)}格` : '';
    ui('offset').textContent = [horizontal, vertical].filter(Boolean).join(' · ') || '原位';
    ui('shifted-title').textContent = overlay ? '橙色：像素值改变的位置' : '拖动这间小屋';
    ui('pixel-changes').textContent = `${result.changedPixels}个轮廓像素发生变化`;
    ui('edge-score').textContent = `${Math.round(result.edgeSimilarity * 100)}%`;
    ui('edge-meter').value = result.edgeSimilarity;
    ui('hog-result').hidden = !showFeatures;
    ui('hog-score').textContent = `${Math.round(result.hogSimilarity * 100)}%`;
    ui('hog-meter').value = result.hogSimilarity;
    ui('idea').hidden = !showFeatures;
    ui('overlay').setAttribute('aria-pressed', String(overlay));
    ui('overlay').textContent = overlay ? '隐藏变化标记' : '标出像素变化';
    ui('show-hog').hidden = showFeatures;
    ui('home').disabled = !dx && !dy;
    const difference = result.hogSimilarity - result.edgeSimilarity;
    ui('conclusion').textContent = !dx && !dy
      ? '回到原位，两种比较都是100%。'
      : Math.abs(difference) < .005 ? '这次移动，两种描述的相似程度接近。'
        : difference > 0 ? '这次移动，HOG特征的相似程度更高。'
          : '这次移动，HOG特征的相似程度更低；HOG也会受位置影响。';
  }

  function moveTo(x, y) {
    const next = clampIntroShift(x, y);
    if (dx === next.dx && dy === next.dy) return;
    dx = next.dx; dy = next.dy; render();
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null; moving.classList.remove('is-dragging');
  }

  moving.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault(); moving.focus({ preventScroll:true });
    const rect = moving.getBoundingClientRect();
    drag = { id:event.pointerId, x:event.clientX, y:event.clientY, dx, dy, unit:rect.width / 48 };
    moving.setPointerCapture(event.pointerId); moving.classList.add('is-dragging');
  });
  moving.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    moveTo(drag.dx + (event.clientX - drag.x) / drag.unit, drag.dy + (event.clientY - drag.y) / drag.unit);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) moving.addEventListener(type, endDrag);
  moving.addEventListener('keydown', event => {
    const delta = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] }[event.key];
    if (event.key === 'Home') { event.preventDefault(); moveTo(0,0); }
    else if (delta) { event.preventDefault(); moveTo(dx + delta[0], dy + delta[1]); }
  });

  function reset() {
    if (drag && moving.hasPointerCapture(drag.id)) moving.releasePointerCapture(drag.id);
    drag = null; moving.classList.remove('is-dragging');
    dx = 0; dy = 0; overlay = false; showFeatures = false; render();
  }

  panel.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.hogIntroAction;
    if (action === 'overlay') { overlay = !overlay; render(); }
    if (action === 'features') { showFeatures = true; render(); }
    if (action === 'home') moveTo(0,0);
  });
  return { refresh:render, reset,
    snapshot: () => ({ dx, dy, overlay, showFeatures }),
    restore(saved) {
      if (!saved || !Number.isFinite(saved.dx) || !Number.isFinite(saved.dy)) return;
      ({ dx, dy } = clampIntroShift(saved.dx, saved.dy));
      overlay = saved.overlay === true; showFeatures = saved.showFeatures === true;
    },
  };
}
