import type { OpSet, ResolvedOptions } from '../core.js';
import type { Point } from '../geometry.js';
import type { PatternFiller, RenderHelper } from './filler-interface.js';
export declare class DotFiller implements PatternFiller {
    private helper;
    constructor(helper: RenderHelper);
    private dotsOnLines;
    fillPolygons(polygonList: Point[][], o: ResolvedOptions): OpSet;
}
//# sourceMappingURL=dot-filler.d.ts.map