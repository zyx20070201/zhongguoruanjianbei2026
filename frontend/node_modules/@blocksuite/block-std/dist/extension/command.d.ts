import type { BlockCommands } from '../spec/index.js';
import type { ExtensionType } from './extension.js';
/**
 * Create a command extension.
 *
 * @param commands A map of command names to command implementations.
 *
 * @example
 * ```ts
 * import { CommandExtension } from '@blocksuite/block-std';
 *
 * const MyCommandExtension = CommandExtension({
 *   'my-command': MyCommand
 * });
 * ```
 */
export declare function CommandExtension(commands: BlockCommands): ExtensionType;
//# sourceMappingURL=command.d.ts.map