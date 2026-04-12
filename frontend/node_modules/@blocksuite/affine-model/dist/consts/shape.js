import { z } from 'zod';
import { LINE_COLORS, LineColor } from './line.js';
export const DEFAULT_ROUGHNESS = 1.4;
// TODO: need to check the default central area ratio
export const DEFAULT_CENTRAL_AREA_RATIO = 0.3;
export var ShapeTextFontSize;
(function (ShapeTextFontSize) {
    ShapeTextFontSize[ShapeTextFontSize["LARGE"] = 28] = "LARGE";
    ShapeTextFontSize[ShapeTextFontSize["MEDIUM"] = 20] = "MEDIUM";
    ShapeTextFontSize[ShapeTextFontSize["SMALL"] = 12] = "SMALL";
    ShapeTextFontSize[ShapeTextFontSize["XLARGE"] = 36] = "XLARGE";
})(ShapeTextFontSize || (ShapeTextFontSize = {}));
export var ShapeType;
(function (ShapeType) {
    ShapeType["Diamond"] = "diamond";
    ShapeType["Ellipse"] = "ellipse";
    ShapeType["Rect"] = "rect";
    ShapeType["Triangle"] = "triangle";
})(ShapeType || (ShapeType = {}));
export function getShapeName(type, radius) {
    if (type === ShapeType.Rect && radius > 0) {
        return 'roundedRect';
    }
    return type;
}
export function getShapeType(name) {
    if (name === 'roundedRect') {
        return ShapeType.Rect;
    }
    return name;
}
export function getShapeRadius(name) {
    if (name === 'roundedRect') {
        return 0.1;
    }
    return 0;
}
export var ShapeStyle;
(function (ShapeStyle) {
    ShapeStyle["General"] = "General";
    ShapeStyle["Scribbled"] = "Scribbled";
})(ShapeStyle || (ShapeStyle = {}));
export var ShapeFillColor;
(function (ShapeFillColor) {
    ShapeFillColor["Black"] = "--affine-palette-shape-black";
    ShapeFillColor["Blue"] = "--affine-palette-shape-blue";
    ShapeFillColor["Green"] = "--affine-palette-shape-green";
    ShapeFillColor["Grey"] = "--affine-palette-shape-grey";
    ShapeFillColor["Magenta"] = "--affine-palette-shape-magenta";
    ShapeFillColor["Orange"] = "--affine-palette-shape-orange";
    ShapeFillColor["Purple"] = "--affine-palette-shape-purple";
    ShapeFillColor["Red"] = "--affine-palette-shape-red";
    ShapeFillColor["Teal"] = "--affine-palette-shape-teal";
    ShapeFillColor["White"] = "--affine-palette-shape-white";
    ShapeFillColor["Yellow"] = "--affine-palette-shape-yellow";
})(ShapeFillColor || (ShapeFillColor = {}));
export const SHAPE_FILL_COLORS = [
    ShapeFillColor.Yellow,
    ShapeFillColor.Orange,
    ShapeFillColor.Red,
    ShapeFillColor.Magenta,
    ShapeFillColor.Purple,
    ShapeFillColor.Blue,
    ShapeFillColor.Teal,
    ShapeFillColor.Green,
    ShapeFillColor.Black,
    ShapeFillColor.Grey,
    ShapeFillColor.White,
];
export const DEFAULT_SHAPE_FILL_COLOR = ShapeFillColor.Yellow;
export const FillColorsSchema = z.nativeEnum(ShapeFillColor);
export const SHAPE_STROKE_COLORS = LINE_COLORS;
export const DEFAULT_SHAPE_STROKE_COLOR = LineColor.Yellow;
export const DEFAULT_SHAPE_TEXT_COLOR = LineColor.Black;
export const StrokeColorsSchema = z.nativeEnum(LineColor);
//# sourceMappingURL=shape.js.map