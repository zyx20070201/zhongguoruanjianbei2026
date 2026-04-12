import type { BezierCurveParameters, IVec, PointLocation } from '@blocksuite/global/utils';
import { type ConnectorElementModel, ConnectorMode, type LocalConnectorElementModel } from '@blocksuite/affine-model';
import type { RoughCanvas } from '../../../utils/rough/canvas.js';
type ConnectorEnd = 'Front' | 'Rear';
export declare const DEFAULT_ARROW_SIZE = 15;
export declare function getArrowPoints(points: PointLocation[], size: number | undefined, mode: ConnectorMode, bezierParameters: BezierCurveParameters, endPoint?: ConnectorEnd, radians?: number): {
    points: (IVec | PointLocation)[];
};
export declare function getCircleCenterPoint(points: PointLocation[], radius: number | undefined, mode: ConnectorMode, bezierParameters: BezierCurveParameters, endPoint?: ConnectorEnd): IVec;
export declare function getPointWithTangent(points: PointLocation[], mode: ConnectorMode, endPoint: ConnectorEnd, bezierParameters: BezierCurveParameters): PointLocation;
export declare function getDiamondPoints(point: PointLocation, size?: number, endPoint?: ConnectorEnd): {
    points: (IVec | PointLocation)[];
};
export type ArrowOptions = ReturnType<typeof getArrowOptions>;
export declare function getArrowOptions(end: ConnectorEnd, model: ConnectorElementModel | LocalConnectorElementModel, strokeColor: string): {
    end: ConnectorEnd;
    seed: number;
    mode: ConnectorMode;
    rough: boolean | undefined;
    roughness: number;
    strokeWidth: number;
    strokeColor: string;
    fillColor: string;
    fillStyle: string;
    bezierParameters: BezierCurveParameters;
};
export declare function getRcOptions(options: ArrowOptions): {
    seed: number;
    roughness: number;
    stroke: string;
    strokeWidth: number;
    fill: string;
    fillStyle: string;
};
export declare function renderRoundedPolygon(ctx: CanvasRenderingContext2D, points: IVec[], color: string, strokeWidth: number, fill?: boolean): void;
export declare function renderArrow(points: PointLocation[], ctx: CanvasRenderingContext2D, rc: RoughCanvas, options: ArrowOptions): void;
export declare function renderTriangle(points: PointLocation[], ctx: CanvasRenderingContext2D, rc: RoughCanvas, options: ArrowOptions): void;
export declare function renderDiamond(points: PointLocation[], ctx: CanvasRenderingContext2D, rc: RoughCanvas, options: ArrowOptions): void;
export declare function renderCircle(points: PointLocation[], ctx: CanvasRenderingContext2D, rc: RoughCanvas, options: ArrowOptions): void;
export {};
//# sourceMappingURL=utils.d.ts.map