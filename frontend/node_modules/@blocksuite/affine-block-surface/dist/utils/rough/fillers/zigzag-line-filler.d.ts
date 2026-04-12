import type { OpSet, ResolvedOptions } from '../core.js';
import type { Point } from '../geometry.js';
import type { PatternFiller, RenderHelper } from './filler-interface.js';
export declare class ZigZagLineFiller implements PatternFiller {
    private helper;
    constructor(helper: RenderHelper);
    private zigzagLines;
    fillPolygons(polygonList: Point[][], o: ResolvedOptions): OpSet;
}
//# sourceMappingURL=zigzag-line-filler.d.ts.map