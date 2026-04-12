import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import { BlockServiceIdentifier, LifeCycleWatcherIdentifier, StdIdentifier, } from '../identifier.js';
import { LifeCycleWatcher } from './lifecycle-watcher.js';
const idMap = new Map();
/**
 * @deprecated
 * BlockServiceWatcher is deprecated. You should reconsider where to put your feature.
 *
 * BlockServiceWatcher is a legacy extension that is used to watch the slots registered on block service.
 * However, we recommend using the new extension system.
 */
export class BlockServiceWatcher extends LifeCycleWatcher {
    constructor(std, blockService) {
        super(std);
        this.blockService = blockService;
    }
    static setup(di) {
        if (!this.flavour) {
            throw new BlockSuiteError(ErrorCode.ValueNotExists, 'Flavour is not defined in the BlockServiceWatcher');
        }
        const id = idMap.get(this.flavour) ?? 0;
        idMap.set(this.flavour, id + 1);
        di.addImpl(LifeCycleWatcherIdentifier(`${this.flavour}-watcher-${id}`), this, [StdIdentifier, BlockServiceIdentifier(this.flavour)]);
    }
}
//# sourceMappingURL=service-watcher.js.map