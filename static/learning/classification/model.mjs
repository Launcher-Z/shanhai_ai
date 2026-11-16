/* 树和距离计算保持独立，活动、札记预览及验证共用同一套规则。 */
export function treePaths(tree, animals, features) {
  return animals.map(animal => {
    let node = tree;
    const decisions = [];
    for (let depth = 0; depth <= 6; depth++) {
      if (!node?.feature) break;
      const feature = features.find(item => item.id === node.feature);
      if (!feature) break;
      const yes = animal.traits.includes(node.feature);
      decisions.push(`${feature.label}${yes ? '是' : '否'}`);
      node = node[yes ? 'yes' : 'no'];
    }
    const result = animals.find(item => item.id === node?.animal);
    return {animal, decisions, result, correct: result?.id === animal.id};
  });
}

export function treeComplete(tree, animals, features, depth = 0) {
  if (!tree || depth > 6 || !animals.length) return false;
  if (tree.animal) return animals.length === 1 && animals[0].id === tree.animal;
  if (!features.some(feature => feature.id === tree.feature)) return false;
  return treeComplete(tree.yes, animals.filter(a => a.traits.includes(tree.feature)), features, depth + 1)
    && treeComplete(tree.no, animals.filter(a => !a.traits.includes(tree.feature)), features, depth + 1);
}

export function nearest(samples, target, k) {
  const neighbors = samples.map(point => ({...point, distance: Math.hypot(point.x - target.x, point.y - target.y)}))
    .sort((a,b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0,k);
  const monkey = neighbors.filter(point => point.type === 'monkey').length;
  const leopard = neighbors.length - monkey;
  return {neighbors, monkey, leopard, result: monkey === leopard ? 'tie' : monkey > leopard ? 'monkey' : 'leopard'};
}
