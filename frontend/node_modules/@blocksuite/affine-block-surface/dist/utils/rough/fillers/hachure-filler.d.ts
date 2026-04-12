import type { Op, OpSet, ResolvedOptions } from '../core.js';
import type { Line, Point } from '../geometry.js';
import type { PatternFiller, RenderHelper } from './filler-interface.js';
export declare class HachureFiller implements PatternFiller {
    private helper;
    constructor(helper: RenderHelper);
    protected _fillPolygons(polygonList: Point[][], o: ResolvedOptions): OpSet;
    fillPolygons(polygonList: Point[][], o: ResolvedOptions): OpSet;
    protected renderLines(lines: Line[], o: ResolvedOptions): Op[];
}
//# sourceMappingURL=hachure-filler.d.ts.map