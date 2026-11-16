/* 固定预训练特征后，只训练最后的加权分类层。所有类别共享同一输入。 */
export function normalize(values) {
  const length = Math.hypot(...values) || 1;
  return Array.from(values, value => value / length);
}
export function createClassifier(size, names) {
  return {names:[...names], weights:names.map(() => Array(size).fill(0)), bias:names.map(() => 0), epochs:0};
}
export function predict(model, features) {
  const scores = model.weights.map((row, c) => row.reduce((sum, weight, i) => sum + weight * features[i], model.bias[c]));
  const maximum = Math.max(...scores);
  const exps = scores.map(value => Math.exp(value - maximum));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map(value => value / total);
}
export function trainEpoch(model, samples, rate = 2) {
  const dw = model.weights.map(row => row.map(() => 0)), db = model.bias.map(() => 0);
  let loss = 0;
  for (const sample of samples) {
    const probabilities = predict(model, sample.features);
    loss -= Math.log(Math.max(1e-9, probabilities[sample.label]));
    probabilities.forEach((probability, c) => {
      const error = probability - (c === sample.label ? 1 : 0);
      db[c] += error;
      sample.features.forEach((value, i) => { dw[c][i] += error * value; });
    });
  }
  model.weights.forEach((row, c) => {
    row.forEach((value, i) => { row[i] = value - rate * dw[c][i] / samples.length; });
    model.bias[c] -= rate * db[c] / samples.length;
  });
  model.epochs++;
  return loss / samples.length;
}
