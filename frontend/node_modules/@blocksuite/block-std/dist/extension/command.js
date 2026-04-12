import { CommandIdentifier } from '../identifier.js';
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
export function CommandExtension(commands) {
    return {
        setup: di => {
            Object.entries(commands).forEach(([name, command]) => {
                di.addImpl(CommandIdentifier(name), () => command);
            });
        },
    };
}
//# sourceMappingURL=command.js.map