import type { OpSet, ResolvedOptions } from '../core.js';
import type { Point } from '../geometry.js';
import type { PatternFiller, RenderHelper } from './filler-interface.js';
export declare class DashedFiller implements PatternFiller {
    private helper;
    constructor(helper: RenderHelper);
    private dashedLine;
    fillPolygons(polygonList: Point[][], o: ResolvedOptions): OpSet;
}
//# sourceMappingURL=dashed-filler.d.ts.map