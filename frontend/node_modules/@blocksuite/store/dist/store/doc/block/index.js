import { BlockViewType } from '../consts.js';
import { SyncController } from './sync-controller.js';
export * from './types.js';
export class Block {
    get flavour() {
        return this._syncController.flavour;
    }
    get id() {
        return this._syncController.id;
    }
    get model() {
        return this._syncController.model;
    }
    get pop() {
        return this._syncController.pop;
    }
    get stash() {
        return this._syncController.stash;
    }
    get version() {
        return this._syncController.version;
    }
    constructor(schema, yBlock, doc, options = {}) {
        this.schema = schema;
        this.yBlock = yBlock;
        this.doc = doc;
        this.options = options;
        this.blockViewType = BlockViewType.Display;
        const onChange = !options.onChange
            ? undefined
            : (key, value) => {
                options.onChange?.(this, key, value);
            };
        this._syncController = new SyncController(schema, yBlock, doc, onChange);
    }
}
//# sourceMappingURL=index.js.map