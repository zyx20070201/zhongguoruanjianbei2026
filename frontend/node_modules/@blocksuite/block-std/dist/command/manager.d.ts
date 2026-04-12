import type { Chain, ExecCommandResult, IfAllKeysOptional, InDataOfCommand, InitCommandCtx } from './types.js';
import { LifeCycleWatcher } from '../extension/index.js';
/**
 * Command manager to manage all commands
 *
 * Commands are functions that take a context and a next function as arguments
 *
 * ```ts
 * const myCommand: Command<'count', 'count'> = (ctx, next) => {
 *  const count = ctx.count || 0;
 *
 *  const success = someOperation();
 *  if (success) {
 *    return next({ count: count + 1 });
 *  }
 *  // if the command is not successful, you can return without calling next
 *  return;
 * ```
 *
 * You should always add the command to the global interface `BlockSuite.Commands`
 * ```ts
 * declare global {
 *   namespace BlockSuite {
 *     interface Commands {
 *       'myCommand': typeof myCommand
 *     }
 *   }
 * }
 * ```
 *
 * Command input and output data can be defined in the `Command` type
 *
 * ```ts
 * // input: ctx.firstName, ctx.lastName
 * // output: ctx.fullName
 * const myCommand: Command<'firstName' | 'lastName', 'fullName'> = (ctx, next) => {
 *   const { firstName, lastName } = ctx;
 *   const fullName = `${firstName} ${lastName}`;
 *   return next({ fullName });
 * }
 *
 * declare global {
 *   namespace BlockSuite {
 *     interface CommandContext {
 *       // All command input and output data should be defined here
 *       // The keys should be optional
 *       firstName?: string;
 *       lastName?: string;
 *       fullName?: string;
 *     }
 *   }
 * }
 *
 * ```
 *
 *
 * ---
 *
 * Commands can be run in two ways:
 *
 * 1. Using `exec` method
 * `exec` is used to run a single command
 * ```ts
 * const { success, ...data } = commandManager.exec('myCommand', payload);
 * ```
 *
 * 2. Using `chain` method
 * `chain` is used to run a series of commands
 * ```ts
 * const chain = commandManager.chain();
 * const [result, data] = chain
 *   .myCommand1()
 *   .myCommand2(payload)
 *   .run();
 * ```
 *
 * ---
 *
 * Command chains will stop running if a command is not successful
 *
 * ```ts
 * const chain = commandManager.chain();
 * const [result, data] = chain
 *   .myCommand1() <-- if this fail
 *   .myCommand2(payload) <- this won't run
 *   .run();
 *
 * result <- result will be `false`
 * ```
 *
 * You can use `try` to run a series of commands and if one of them is successful, it will continue to the next command
 * ```ts
 * const chain = commandManager.chain();
 * const [result, data] = chain
 *   .try(chain => [
 *     chain.myCommand1(), <- if this fail
 *     chain.myCommand2(), <- this will run, if this success
 *     chain.myCommand3(), <- this won't run
 *   ])
 *   .run();
 * ```
 *
 * The `tryAll` method is similar to `try`, but it will run all commands even if one of them is successful
 * ```ts
 * const chain = commandManager.chain();
 * const [result, data] = chain
 *   .try(chain => [
 *     chain.myCommand1(), <- if this success
 *     chain.myCommand2(), <- this will also run
 *     chain.myCommand3(), <- so will this
 *   ])
 *   .run();
 * ```
 *
 */
export declare class CommandManager extends LifeCycleWatcher {
    static readonly key = "commandManager";
    private _commands;
    private _createChain;
    private _getCommandCtx;
    /**
     * Create a chain to run a series of commands
     * ```ts
     * const chain = commandManager.chain();
     * const [result, data] = chain
     *   .myCommand1()
     *   .myCommand2(payload)
     *   .run();
     * ```
     * @returns [success, data] - success is a boolean to indicate if the chain is successful,
     *   data is the final context after running the chain
     */
    chain: () => Chain<InitCommandCtx>;
    /**
     * Register a command to the command manager
     * @param name
     * @param command
     * Make sure to also add the command to the global interface `BlockSuite.Commands`
     * ```ts
     * const myCommand: Command = (ctx, next) => {
     *   // do something
     * }
     *
     * declare global {
     *   namespace BlockSuite {
     *     interface Commands {
     *       'myCommand': typeof myCommand
     *     }
     *   }
     * }
     * ```
     */
    add<N extends BlockSuite.CommandName>(name: N, command: BlockSuite.Commands[N]): CommandManager;
    created(): void;
    /**
     * Execute a registered command by name
     * @param command
     * @param payloads
     * ```ts
     * const { success, ...data } = commandManager.exec('myCommand', { data: 'data' });
     * ```
     * @returns { success, ...data } - success is a boolean to indicate if the command is successful,
     *  data is the final context after running the command
     */
    exec<K extends keyof BlockSuite.Commands>(command: K, ...payloads: IfAllKeysOptional<Omit<InDataOfCommand<BlockSuite.Commands[K]>, keyof InitCommandCtx>, [
        inData: void | Omit<InDataOfCommand<BlockSuite.Commands[K]>, keyof InitCommandCtx>
    ], [
        inData: Omit<InDataOfCommand<BlockSuite.Commands[K]>, keyof InitCommandCtx>
    ]>): ExecCommandResult<K> & {
        success: boolean;
    };
}
//# sourceMappingURL=manager.d.ts.map