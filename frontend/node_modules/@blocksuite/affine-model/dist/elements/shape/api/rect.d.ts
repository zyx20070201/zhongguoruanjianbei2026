import type { PointTestOptions } from '@blocksuite/block-std/gfx';
import type { IBound, IVec } from '@blocksuite/global/utils';
import { Bound, PointLocation } from '@blocksuite/global/utils';
import type { ShapeElementModel } from '../shape.js';
export declare const rect: {
    points({ x, y, w, h }: IBound): number[][];
    draw(ctx: CanvasRenderingContext2D, { x, y, w, h, rotate }: IBound): void;
    includesPoint(this: ShapeElementModel, x: number, y: number, options: PointTestOptions): boolean;
    containsBound(bounds: Bound, element: ShapeElementModel): boolean;
    getNearestPoint(point: IVec, element: ShapeElementModel): IVec;
    getLineIntersections(start: IVec, end: IVec, element: ShapeElementModel): PointLocation[] | null;
    getRelativePointLocation(relativePoint: IVec, element: ShapeElementModel): PointLocation;
};
//# sourceMappingURL=rect.d.ts.map