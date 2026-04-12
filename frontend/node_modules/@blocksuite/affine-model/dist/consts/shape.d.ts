import { z } from 'zod';
import { LineColor } from './line.js';
export declare const DEFAULT_ROUGHNESS = 1.4;
export declare const DEFAULT_CENTRAL_AREA_RATIO = 0.3;
export declare enum ShapeTextFontSize {
    LARGE = 28,
    MEDIUM = 20,
    SMALL = 12,
    XLARGE = 36
}
export declare enum ShapeType {
    Diamond = "diamond",
    Ellipse = "ellipse",
    Rect = "rect",
    Triangle = "triangle"
}
export type ShapeName = ShapeType | 'roundedRect';
export declare function getShapeName(type: ShapeType, radius: number): ShapeName;
export declare function getShapeType(name: ShapeName): ShapeType;
export declare function getShapeRadius(name: ShapeName): number;
export declare enum ShapeStyle {
    General = "General",
    Scribbled = "Scribbled"
}
export declare enum ShapeFillColor {
    Black = "--affine-palette-shape-black",
    Blue = "--affine-palette-shape-blue",
    Green = "--affine-palette-shape-green",
    Grey = "--affine-palette-shape-grey",
    Magenta = "--affine-palette-shape-magenta",
    Orange = "--affine-palette-shape-orange",
    Purple = "--affine-palette-shape-purple",
    Red = "--affine-palette-shape-red",
    Teal = "--affine-palette-shape-teal",
    White = "--affine-palette-shape-white",
    Yellow = "--affine-palette-shape-yellow"
}
export declare const SHAPE_FILL_COLORS: readonly [ShapeFillColor.Yellow, ShapeFillColor.Orange, ShapeFillColor.Red, ShapeFillColor.Magenta, ShapeFillColor.Purple, ShapeFillColor.Blue, ShapeFillColor.Teal, ShapeFillColor.Green, ShapeFillColor.Black, ShapeFillColor.Grey, ShapeFillColor.White];
export declare const DEFAULT_SHAPE_FILL_COLOR = ShapeFillColor.Yellow;
export declare const FillColorsSchema: z.ZodNativeEnum<typeof ShapeFillColor>;
export declare const SHAPE_STROKE_COLORS: readonly [LineColor.Yellow, LineColor.Orange, LineColor.Red, LineColor.Magenta, LineColor.Purple, LineColor.Blue, LineColor.Teal, LineColor.Green, LineColor.Black, LineColor.Grey, LineColor.White];
export declare const DEFAULT_SHAPE_STROKE_COLOR = LineColor.Yellow;
export declare const DEFAULT_SHAPE_TEXT_COLOR = LineColor.Black;
export declare const StrokeColorsSchema: z.ZodNativeEnum<typeof LineColor>;
//# sourceMappingURL=shape.d.ts.map