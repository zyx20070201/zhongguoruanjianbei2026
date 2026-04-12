import type { Config } from './core.js';
import { RoughCanvas } from './canvas.js';
import { RoughGenerator } from './generator.js';
import { RoughSVG } from './svg.js';
declare const _default: {
    canvas(canvas: HTMLCanvasElement, config?: Config): RoughCanvas;
    svg(svg: SVGSVGElement, config?: Config): RoughSVG;
    generator(config?: Config): RoughGenerator;
    newSeed(): number;
};
export default _default;
//# sourceMappingURL=rough.d.ts.map