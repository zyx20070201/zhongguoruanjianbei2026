import type { Container } from '@blocksuite/global/di';
import type { BlockStdScope } from '../scope/index.js';
import type { BlockService } from './service.js';
import { LifeCycleWatcher } from './lifecycle-watcher.js';
/**
 * @deprecated
 * BlockServiceWatcher is deprecated. You should reconsider where to put your feature.
 *
 * BlockServiceWatcher is a legacy extension that is used to watch the slots registered on block service.
 * However, we recommend using the new extension system.
 */
export declare abstract class BlockServiceWatcher extends LifeCycleWatcher {
    readonly blockService: BlockService;
    static flavour: string;
    constructor(std: BlockStdScope, blockService: BlockService);
    static setup(di: Container): void;
}
//# sourceMappingURL=service-watcher.d.ts.map