import type { GroupElementModel } from '@blocksuite/affine-model';
import { Bound } from '@blocksuite/global/utils';
export declare function titleRenderParams(group: GroupElementModel, zoom: number): {
    font: string;
    bound: Bound;
    text: string;
    titleWidth: number;
    titleHeight: number;
    offset: number;
    lineHeight: number;
    padding: number[];
    titleBound: Bound;
};
export declare function titleBound(group: GroupElementModel, zoom: number): Bound;
//# sourceMappingURL=utils.d.ts.map