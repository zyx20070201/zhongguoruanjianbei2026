import type { Bound, IVec3 } from '@blocksuite/global/utils';
export declare class AStarRunner {
    private _sp;
    private _ep;
    private _originalSp;
    private _originalEp;
    private _cameFrom;
    private _complete;
    private _costSoFar;
    private _current;
    private _diagonalCount;
    private _frontier;
    private _graph;
    private _pointPriority;
    get path(): IVec3[];
    constructor(points: IVec3[], _sp: IVec3, _ep: IVec3, _originalSp: IVec3, _originalEp: IVec3, blocks?: Bound[], expandBlocks?: Bound[]);
    private _init;
    private _neighbors;
    reset(): void;
    run(): void;
    step(): void;
}
//# sourceMappingURL=a-star.d.ts.map