import type { Schema } from '../../../schema/index.js';
import type { Doc } from '../doc.js';
import type { BlockOptions, YBlock } from './types.js';
import { BlockViewType } from '../consts.js';
export * from './types.js';
export declare class Block {
    readonly schema: Schema;
    readonly yBlock: YBlock;
    readonly doc?: Doc | undefined;
    readonly options: BlockOptions;
    private _syncController;
    blockViewType: BlockViewType;
    get flavour(): string;
    get id(): string;
    get model(): import("../../../schema/base.js").BlockModel<object, object & {}>;
    get pop(): (prop: string) => void;
    get stash(): (prop: string) => void;
    get version(): number;
    constructor(schema: Schema, yBlock: YBlock, doc?: Doc | undefined, options?: BlockOptions);
}
//# sourceMappingURL=index.d.ts.map