// 用少量不同深度的细雨线模拟风雨；画布仅用于装饰，不影响登录操作。
(() => {
  const canvas = document.querySelector('.storm-rain');
  if (!canvas) return;

  const context = canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!context) return;

  let width = 0;
  let height = 0;
  let drops = [];
  let frameId = 0;
  let previousTime = 0;

  const random = (min, max) => min + Math.random() * (max - min);
  const makeDrop = (anywhere = false) => ({
    x: random(-width * .2, width * 1.2),
    y: anywhere ? random(-height, height) : random(-height * .25, -10),
    length: random(12, 30),
    speed: random(420, 760),
    opacity: random(.16, .38),
    width: random(.6, 1)
  });

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    // 限制画布分辨率和雨滴数量，照顾普通课堂电脑。
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.min(145, Math.max(45, Math.round(width * height / 10500)));
    drops = Array.from({ length: count }, () => makeDrop(true));
  };

  const draw = (time) => {
    // 控制绘制频率，避免为了背景动画持续占满 GPU。
    if (time - previousTime < 33) {
      frameId = requestAnimationFrame(draw);
      return;
    }
    const elapsed = previousTime ? Math.min((time - previousTime) / 1000, .1) : 0;
    previousTime = time;
    context.clearRect(0, 0, width, height);

    drops.forEach((drop, index) => {
      drop.y += drop.speed * elapsed;
      drop.x -= drop.speed * elapsed * .22;
      if (drop.y > height + drop.length || drop.x < -drop.length) {
        drops[index] = makeDrop();
        return;
      }
      context.beginPath();
      context.moveTo(drop.x, drop.y);
      context.lineTo(drop.x + drop.length * .22, drop.y - drop.length);
      context.strokeStyle = `rgba(195, 216, 218, ${drop.opacity})`;
      context.lineWidth = drop.width;
      context.stroke();
    });
    frameId = requestAnimationFrame(draw);
  };

  const updateMotion = () => {
    cancelAnimationFrame(frameId);
    frameId = 0;
    previousTime = 0;
    context.clearRect(0, 0, width, height);
    if (!reducedMotion.matches && !document.hidden) frameId = requestAnimationFrame(draw);
  };

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', updateMotion);
  reducedMotion.addEventListener('change', updateMotion);
  resize();
  updateMotion();
})();
