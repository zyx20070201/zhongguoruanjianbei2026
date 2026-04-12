import * as Y from 'yjs';
import type { Schema } from '../../../schema/schema.js';
import type { Doc } from '../doc.js';
import type { YBlock } from './types.js';
import { BlockModel } from '../../../schema/base.js';
/**
 * @internal
 * SyncController is responsible for syncing the block data with Yjs.
 * It creates a proxy model that syncs with Yjs and provides a reactive interface.
 * It also handles the stashing and popping of props.
 * It will also provide signals for block props.
 *
 */
export declare class SyncController {
    readonly schema: Schema;
    readonly yBlock: YBlock;
    readonly doc?: Doc | undefined;
    readonly onChange?: ((key: string, value: unknown) => void) | undefined;
    private _byPassProxy;
    private readonly _byPassUpdate;
    private readonly _mutex;
    private readonly _observeYBlockChanges;
    private readonly _stashed;
    readonly flavour: string;
    readonly id: string;
    readonly model: BlockModel;
    readonly pop: (prop: string) => void;
    readonly stash: (prop: string) => void;
    readonly version: number;
    readonly yChildren: Y.Array<string[]>;
    constructor(schema: Schema, yBlock: YBlock, doc?: Doc | undefined, onChange?: ((key: string, value: unknown) => void) | undefined);
    private _createModel;
    private _getPropsProxy;
    private _parseYBlock;
    private _popProp;
    private _stashProp;
}
//# sourceMappingURL=sync-controller.d.ts.map