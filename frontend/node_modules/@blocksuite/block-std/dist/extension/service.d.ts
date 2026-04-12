import type { Container } from '@blocksuite/global/di';
import { DisposableGroup } from '@blocksuite/global/utils';
import type { EventName, UIEventHandler } from '../event/index.js';
import type { BlockStdScope } from '../scope/index.js';
import { Extension } from './extension.js';
/**
 * @deprecated
 * BlockService is deprecated. You should reconsider where to put your feature.
 *
 * BlockService is a legacy extension that is used to provide services to the block.
 * In the previous version of BlockSuite, block service provides a way to extend the block.
 * However, in the new version, we recommend using the new extension system.
 */
export declare abstract class BlockService extends Extension {
    readonly std: BlockStdScope;
    readonly flavourProvider: {
        flavour: string;
    };
    static flavour: string;
    readonly disposables: DisposableGroup;
    readonly flavour: string;
    readonly specSlots: import("../spec/slots.js").BlockSpecSlots<BlockService>;
    get collection(): import("@blocksuite/store").DocCollection;
    get doc(): import("@blocksuite/store").Doc;
    get host(): import("../index.js").EditorHost;
    get selectionManager(): import("../index.js").SelectionManager;
    get uiEventDispatcher(): import("../event/dispatcher.js").UIEventDispatcher;
    constructor(std: BlockStdScope, flavourProvider: {
        flavour: string;
    });
    static setup(di: Container): void;
    bindHotKey(keymap: Record<string, UIEventHandler>, options?: {
        global: boolean;
    }): void;
    dispose(): void;
    handleEvent(name: EventName, fn: UIEventHandler, options?: {
        global: boolean;
    }): void;
    mounted(): void;
    unmounted(): void;
}
//# sourceMappingURL=service.d.ts.map