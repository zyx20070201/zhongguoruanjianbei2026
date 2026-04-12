import type { BlockComponent, Command } from '@blocksuite/block-std';
export declare const getPrevBlockCommand: Command<'currentSelectionPath', 'prevBlock', {
    path?: string;
}>;
declare global {
    namespace BlockSuite {
        interface CommandContext {
            prevBlock?: BlockComponent;
        }
        interface Commands {
            getPrevBlock: typeof getPrevBlockCommand;
        }
    }
}
//# sourceMappingURL=get-prev-block.d.ts.map