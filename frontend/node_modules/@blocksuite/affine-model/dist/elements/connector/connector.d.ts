import type { BaseElementProps, PointTestOptions, SerializedElement } from '@blocksuite/block-std/gfx';
import type { IVec, SerializedXYWH, XYWH } from '@blocksuite/global/utils';
import { GfxPrimitiveElementModel } from '@blocksuite/block-std/gfx';
import { Bound, PointLocation } from '@blocksuite/global/utils';
import { type Y } from '@blocksuite/store';
import { type Color, ConnectorLabelOffsetAnchor, ConnectorMode, type PointStyle, StrokeStyle, type TextStyleProps } from '../../consts/index.js';
export type SerializedConnection = {
    id?: string;
    position?: `[${number},${number}]` | PointLocation;
};
export type Connection = {
    id?: string;
    position?: [number, number];
};
export declare const getConnectorModeName: (mode: ConnectorMode) => string;
export type ConnectorLabelOffsetProps = {
    distance: number;
    anchor?: ConnectorLabelOffsetAnchor;
};
export type ConnectorLabelConstraintsProps = {
    hasMaxWidth: boolean;
    maxWidth: number;
};
export type ConnectorLabelProps = {
    text?: Y.Text;
    labelEditing?: boolean;
    labelDisplay?: boolean;
    labelXYWH?: XYWH;
    labelOffset?: ConnectorLabelOffsetProps;
    labelStyle?: TextStyleProps;
    labelConstraints?: ConnectorLabelConstraintsProps;
};
export type SerializedConnectorElement = SerializedElement & {
    source: SerializedConnection;
    target: SerializedConnection;
};
export type ConnectorElementProps = BaseElementProps & {
    mode: ConnectorMode;
    stroke: Color;
    strokeWidth: number;
    strokeStyle: StrokeStyle;
    roughness?: number;
    rough?: boolean;
    source: Connection;
    target: Connection;
    frontEndpointStyle?: PointStyle;
    rearEndpointStyle?: PointStyle;
} & ConnectorLabelProps;
export declare class ConnectorElementModel extends GfxPrimitiveElementModel<ConnectorElementProps> {
    updatingPath: boolean;
    get connectable(): false;
    get connected(): boolean;
    get elementBound(): Bound;
    get type(): string;
    static propsToY(props: ConnectorElementProps): ConnectorElementProps;
    containsBound(bounds: Bound): boolean;
    getLineIntersections(start: IVec, end: IVec): PointLocation[] | null;
    /**
     * Calculate the closest point on the curve via a point.
     */
    getNearestPoint(point: IVec): IVec;
    /**
     * Calculating the computed distance along a path via a point.
     *
     * The point is relative to the viewport.
     */
    getOffsetDistanceByPoint(point: IVec, bounds?: Bound): number;
    /**
     * Calculating the computed point along a path via a offset distance.
     *
     * Returns a point relative to the viewport.
     */
    getPointByOffsetDistance(offsetDistance?: number, bounds?: Bound): IVec;
    getRelativePointLocation(point: IVec): PointLocation;
    hasLabel(): boolean;
    includesPoint(x: number, y: number, options?: PointTestOptions | undefined): boolean;
    labelIncludesPoint(point: IVec): boolean;
    moveTo(bound: Bound): void;
    resize(bounds: Bound, originalPath: PointLocation[], matrix: DOMMatrix): {
        labelXYWH?: XYWH;
        source?: Connection;
        target?: Connection;
    };
    resizePath(originalPath: PointLocation[], matrix: DOMMatrix): PointLocation[];
    serialize(): SerializedConnectorElement;
    accessor absolutePath: PointLocation[];
    accessor frontEndpointStyle: PointStyle;
    /**
     * Defines the size constraints of the label.
     */
    accessor labelConstraints: ConnectorLabelConstraintsProps;
    /**
     * Control display and hide.
     */
    accessor labelDisplay: boolean;
    /**
     * The offset property specifies the label along the connector path.
     */
    accessor labelOffset: ConnectorLabelOffsetProps;
    /**
     * Defines the style of the label.
     */
    accessor labelStyle: TextStyleProps;
    /**
     * Returns a `XYWH` array providing information about the size of a label
     * and its position relative to the viewport.
     */
    accessor labelXYWH: XYWH | undefined;
    /**
     * Local control display and hide, mainly used in editing scenarios.
     */
    accessor lableEditing: boolean;
    accessor mode: ConnectorMode;
    accessor path: PointLocation[];
    accessor rearEndpointStyle: PointStyle;
    accessor rotate: number;
    accessor rough: boolean | undefined;
    accessor roughness: number;
    accessor source: Connection;
    accessor stroke: Color;
    accessor strokeStyle: StrokeStyle;
    accessor strokeWidth: number;
    accessor target: Connection;
    /**
     * The content of the label.
     */
    accessor text: Y.Text | undefined;
    accessor xywh: SerializedXYWH;
}
declare global {
    namespace BlockSuite {
        interface SurfaceElementModelMap {
            connector: ConnectorElementModel;
        }
        interface EdgelessTextModelMap {
            connector: ConnectorElementModel;
        }
    }
}
//# sourceMappingURL=connector.d.ts.map