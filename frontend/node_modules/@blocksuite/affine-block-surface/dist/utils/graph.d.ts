import type { Bound, IVec, IVec3 } from '@blocksuite/global/utils';
export declare class Graph<V extends IVec | IVec3 = IVec> {
    private points;
    private blocks;
    private expandedBlocks;
    private excludedPoints;
    private _xMap;
    private _yMap;
    constructor(points: V[], blocks?: Bound[], expandedBlocks?: Bound[], excludedPoints?: V[]);
    private _canSkipBlock;
    private _isBlock;
    neighbors(curPoint: V): V[];
}
//# sourceMappingURL=graph.d.ts.map