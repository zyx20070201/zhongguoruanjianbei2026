import type { IBound } from '@blocksuite/global/utils';
import type { RoughCanvas, SurfaceElementModel } from '../../index.js';
import type { CanvasRenderer } from '../canvas-renderer.js';
export { normalizeShapeBound } from './shape/utils.js';
export type ElementRenderer<T extends BlockSuite.SurfaceElementModel = SurfaceElementModel> = (model: T, ctx: CanvasRenderingContext2D, matrix: DOMMatrix, renderer: CanvasRenderer, rc: RoughCanvas, viewportBound: IBound) => void;
export declare const elementRenderers: Record<string, ElementRenderer<any>>;
//# sourceMappingURL=index.d.ts.map