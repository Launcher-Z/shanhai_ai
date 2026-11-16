/* 两个输出的单层模型：softmax 与交叉熵，供数据核验和三个草图共同使用。 */
(function (root) {
  'use strict';
  function random(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function create(seed, rate = 0.045) {
    const rng = random(seed);
    return { weights: Array.from({length: 60}, () => [(rng() - .5) * .24, (rng() - .5) * .24]), bias: [0, 0], rate, steps: 0 };
  }
  function predict(model, pixels) {
    const scores = model.bias.slice();
    pixels.forEach((x, i) => { scores[0] += x * model.weights[i][0]; scores[1] += x * model.weights[i][1]; });
    const peak = Math.max(...scores);
    const exp = scores.map(v => Math.exp(v - peak));
    const probs = exp.map(v => v / (exp[0] + exp[1]));
    return { scores, probs, digit: probs[1] > probs[0] ? 1 : 0 };
  }
  function loss(output, label) { return -Math.log(Math.max(output.probs[label], 1e-15)); }
  function train(model, sample) {
    const before = predict(model, sample.pixels);
    const errors = before.probs.map((p, j) => (j === sample.label ? 1 : 0) - p);
    const changes = sample.pixels.map(x => errors.map(e => model.rate * e * x));
    model.weights.forEach((w, i) => w.forEach((_, j) => { w[j] += changes[i][j]; }));
    model.bias.forEach((_, j) => { model.bias[j] += model.rate * errors[j]; });
    model.steps += 1;
    const after = predict(model, sample.pixels);
    return { before, after, changes, errors, beforeLoss: loss(before, sample.label), afterLoss: loss(after, sample.label) };
  }
  function evaluate(model, samples) {
    const results = samples.map(s => ({ id:s.id, label:s.label, ...predict(model, s.pixels) }));
    return { correct: results.filter(s => s.digit === s.label).length, results };
  }
  const api = { create, predict, train, evaluate, loss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DigitModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
