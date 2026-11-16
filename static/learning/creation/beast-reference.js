/* 原文和8.1旧图共用服务器映射；参考图不作为文生图输入。 */
import { el } from './common.js';

export function referenceFigure(beast) {
  const figure = el('figure', undefined, 'creation-reference');
  if (!beast?.image) return figure;
  const image = el('img');
  image.src = beast.image;
  image.alt = `8.1参考原图：${beast.name}`;
  image.loading = 'lazy';
  const link = el('a');
  link.href = beast.image;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = '点击查看参考原图';
  link.append(image);
  const number = beast.image_id?.split('-').pop();
  figure.append(link, el('figcaption', `8.1参考原图${number ? ` · 图${number}` : ''}`));
  return figure;
}

export function selectableBeasts(beasts, selectedId) {
  return beasts.filter((beast) => beast.selectable !== false || beast.id === selectedId);
}
