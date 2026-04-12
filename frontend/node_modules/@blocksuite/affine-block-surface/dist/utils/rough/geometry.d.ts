export type Point = [number, number];
export type Line = [Point, Point];
export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}
export declare function rotatePoints(points: Point[], center: Point, degrees: number): void;
export declare function rotateLines(lines: Line[], center: Point, degrees: number): void;
export declare function lineLength(line: Line): number;
//# sourceMappingURL=geometry.d.ts.map