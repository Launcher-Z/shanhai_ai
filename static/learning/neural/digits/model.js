/* [B1] 216 个输入直接连接 10 个输出，无隐藏层。标签只用于训练。 */
(function (root) {
  'use strict';
  const INPUTS = 216, OUTPUTS = 10;
  function random(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function create(seed = 1005, rate = .045) {
    const rng = random(seed);
    return {weights: Array.from({length: INPUTS}, () => Array.from({length: OUTPUTS}, () => (rng() - .5) * .24)), bias: Array(OUTPUTS).fill(0), rate, steps: 0};
  }
  function predict(model, pixels) {
    if (pixels.length !== INPUTS) throw Error('输入必须包含 216 个像素值');
    const scores = model.bias.slice();
    pixels.forEach((x, i) => {
      for (let j = 0; j < OUTPUTS; j++) scores[j] += x * model.weights[i][j];
    });
    // 减去最大值防止指数溢出，不改变 softmax 的比例。
    const peak = Math.max(...scores);
    const exp = scores.map(v => Math.exp(v - peak));
    const total = exp.reduce((a, b) => a + b, 0);
    const probs = exp.map(v => v / total);
    return {scores, probs, digit: probs.indexOf(Math.max(...probs))};
  }
  function loss(output, label) {return -Math.log(Math.max(output.probs[label], 1e-15));}
  function train(model, sample) {
    if (!Number.isInteger(sample.label) || sample.label < 0 || sample.label >= OUTPUTS) throw Error('训练标签必须为 0—9');
    const before = predict(model, sample.pixels);
    const errors = before.probs.map((p, j) => (j === sample.label ? 1 : 0) - p);
    // 梯度下降：Δw = 学习率 ×（目标比例 − 预测比例）× 输入。
    model.weights.forEach((row, i) => row.forEach((_, j) => {
      row[j] += model.rate * errors[j] * sample.pixels[i];
    }));
    model.bias.forEach((_, j) => {model.bias[j] += model.rate * errors[j];});
    model.steps++;
    const after = predict(model, sample.pixels);
    return {before, after, beforeLoss: loss(before, sample.label), afterLoss: loss(after, sample.label)};
  }
  // 快照拷贝参数，时间轴回看不能引用可变的当前模型。
  function snapshot(model, sample = null) {
    return {weights: model.weights.map(row => row.slice()), bias: model.bias.slice(), steps: model.steps,
      sampleId: sample ? sample.id : null, label: sample ? sample.label : null};
  }
  const api = {create, predict, train, loss, snapshot, INPUTS, OUTPUTS};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DigitModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
