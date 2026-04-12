import type { ListBlockModel } from '@blocksuite/affine-model';
import type { BlockModel, Doc } from '@blocksuite/store';
/**
 * correct target is a numbered list, which is divided into two steps:
 * 1. check if there is a numbered list before the target list. If so, adjust the order of the target list
 *    to the order of the previous list plus 1, otherwise set the order to 1
 * 2. find continuous lists starting from the target list and keep their order continuous
 */
export declare function correctNumberedListsOrderToPrev(doc: Doc, modelOrId: BlockModel | string, transact?: boolean): void;
export declare function correctListOrder(doc: Doc, model: ListBlockModel): void;
//# sourceMappingURL=utils.d.ts.map