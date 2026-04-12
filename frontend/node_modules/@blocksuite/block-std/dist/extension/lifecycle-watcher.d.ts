import type { Container } from '@blocksuite/global/di';
import type { BlockStdScope } from '../scope/index.js';
import { Extension } from './extension.js';
/**
 * A life cycle watcher is an extension that watches the life cycle of the editor.
 * It is used to perform actions when the editor is created, mounted, rendered, or unmounted.
 *
 * When creating a life cycle watcher, you must define a key that is unique to the watcher.
 * The key is used to identify the watcher in the dependency injection container.
 * ```ts
 * class MyLifeCycleWatcher extends LifeCycleWatcher {
 *  static override readonly key = 'my-life-cycle-watcher';
 * ```
 *
 * In the life cycle watcher, the methods will be called in the following order:
 * 1. `created`: Called when the std is created.
 * 2. `rendered`: Called when `std.render` is called.
 * 3. `mounted`: Called when the editor host is mounted.
 * 4. `unmounted`: Called when the editor host is unmounted.
 */
export declare abstract class LifeCycleWatcher extends Extension {
    readonly std: BlockStdScope;
    static key: string;
    constructor(std: BlockStdScope);
    static setup(di: Container): void;
    /**
     * Called when std is created.
     */
    created(): void;
    /**
     * Called when editor host is mounted.
     * Which means the editor host emit the `connectedCallback` lifecycle event.
     */
    mounted(): void;
    /**
     * Called when `std.render` is called.
     */
    rendered(): void;
    /**
     * Called when editor host is unmounted.
     * Which means the editor host emit the `disconnectedCallback` lifecycle event.
     */
    unmounted(): void;
}
//# sourceMappingURL=lifecycle-watcher.d.ts.map