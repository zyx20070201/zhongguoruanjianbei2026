import type { Config, Drawable, Options, ResolvedOptions } from './core.js';
import type { Point } from './geometry.js';
import { RoughGenerator } from './generator.js';
export declare class RoughCanvas {
    private canvas;
    private ctx;
    private gen;
    get generator(): RoughGenerator;
    constructor(canvas: HTMLCanvasElement, config?: Config);
    private _drawToContext;
    private fillSketch;
    arc(x: number, y: number, width: number, height: number, start: number, stop: number, closed?: boolean, options?: Options): Drawable;
    circle(x: number, y: number, diameter: number, options?: Options): Drawable;
    curve(points: Point[], options?: Options): Drawable;
    draw(drawable: Drawable): void;
    ellipse(x: number, y: number, width: number, height: number, options?: Options): Drawable;
    getDefaultOptions(): ResolvedOptions;
    line(x1: number, y1: number, x2: number, y2: number, options?: Options): Drawable;
    linearPath(points: Point[], options?: Options): Drawable;
    path(d: string, options?: Options): Drawable;
    polygon(points: Point[], options?: Options): Drawable;
    rectangle(x: number, y: number, width: number, height: number, options?: Options): Drawable;
}
//# sourceMappingURL=canvas.d.ts.map