import type { BlockComponent, Command } from '@blocksuite/block-std';
export declare const getNextBlockCommand: Command<'currentSelectionPath', 'nextBlock', {
    path?: string;
}>;
declare global {
    namespace BlockSuite {
        interface CommandContext {
            nextBlock?: BlockComponent;
        }
        interface Commands {
            getNextBlock: typeof getNextBlockCommand;
        }
    }
}
//# sourceMappingURL=get-next-block.d.ts.map