import type { Config, Drawable, OpSet, Options, PathInfo, ResolvedOptions } from './core.js';
import type { Point } from './geometry.js';
export declare class RoughGenerator {
    private config;
    defaultOptions: ResolvedOptions;
    constructor(config?: Config);
    static newSeed(): number;
    private _d;
    private _o;
    private fillSketch;
    arc(x: number, y: number, width: number, height: number, start: number, stop: number, closed?: boolean, options?: Options): Drawable;
    circle(x: number, y: number, diameter: number, options?: Options): Drawable;
    curve(points: Point[], options?: Options): Drawable;
    ellipse(x: number, y: number, width: number, height: number, options?: Options): Drawable;
    line(x1: number, y1: number, x2: number, y2: number, options?: Options): Drawable;
    linearPath(points: Point[], options?: Options): Drawable;
    opsToPath(drawing: OpSet, fixedDecimals?: number): string;
    path(d: string, options?: Options): Drawable;
    polygon(points: Point[], options?: Options): Drawable;
    rectangle(x: number, y: number, width: number, height: number, options?: Options): Drawable;
    toPaths(drawable: Drawable): PathInfo[];
}
//# sourceMappingURL=generator.d.ts.map