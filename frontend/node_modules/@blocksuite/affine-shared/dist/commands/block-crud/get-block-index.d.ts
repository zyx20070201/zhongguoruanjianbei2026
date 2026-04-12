import type { BlockComponent, Command } from '@blocksuite/block-std';
export declare const getBlockIndexCommand: Command<'currentSelectionPath', 'blockIndex' | 'parentBlock', {
    path?: string;
}>;
declare global {
    namespace BlockSuite {
        interface CommandContext {
            blockIndex?: number;
            parentBlock?: BlockComponent;
        }
        interface Commands {
            getBlockIndex: typeof getBlockIndexCommand;
        }
    }
}
//# sourceMappingURL=get-block-index.d.ts.map