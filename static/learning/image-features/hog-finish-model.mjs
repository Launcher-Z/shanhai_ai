/* 二维坐标只截取完整特征中的两个数，不把它冒充完整HOG或分类结果。 */
export function featurePoint(vector) {
  // 选择两个非零维度便于看清落点；维度编号必须同时显示给学生。
  const visible = vector.map((value, index) => ({value, index}))
    .filter(v => v.value > 0).sort((a, b) => b.value - a.value);
  const a = visible[0] || {value: 0, index: 0};
  const b = visible[Math.max(1, Math.floor(visible.length / 2))] || {value: 0, index: a.index === 0 ? 1 : 0};
  return {x: a.value, y: b.value, xIndex: a.index, yIndex: b.index};
}
