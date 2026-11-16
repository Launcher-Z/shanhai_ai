/* 入口只负责分发，活动二与活动三各自维护课堂状态。 */
import { mountImageEdge } from './edge.js';
import { mountImageHog } from './hog.js';

export function mountImageFeatures(root, onStepChange) {
  return root.dataset.mode === 'edge' ? mountImageEdge(root, onStepChange) : mountImageHog(root, onStepChange);
}
