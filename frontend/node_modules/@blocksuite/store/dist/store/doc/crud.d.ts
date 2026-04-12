import * as Y from 'yjs';
import type { YBlock } from './index.js';
import { type Schema } from '../../schema/index.js';
export declare class DocCRUD {
    private readonly _yBlocks;
    private readonly _schema;
    get root(): string | null;
    constructor(_yBlocks: Y.Map<YBlock>, _schema: Schema);
    private _getSiblings;
    addBlock(id: string, flavour: string, initialProps?: Record<string, unknown>, parent?: string | null, parentIndex?: number): void;
    deleteBlock(id: string, options?: {
        bringChildrenTo?: string;
        deleteChildren?: boolean;
    }): void;
    getNext(id: string): string | null;
    getParent(targetId: string): string | null;
    getPrev(id: string): string | null;
    moveBlocks(blocksToMove: string[], newParent: string, targetSibling?: string | null, shouldInsertBeforeSibling?: boolean): void;
    updateBlockChildren(id: string, children: string[]): void;
}
//# sourceMappingURL=crud.d.ts.map