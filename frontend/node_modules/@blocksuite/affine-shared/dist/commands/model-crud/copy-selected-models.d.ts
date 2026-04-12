import type { Command } from '@blocksuite/block-std';
export declare const copySelectedModelsCommand: Command<'draftedModels' | 'onCopy'>;
declare global {
    namespace BlockSuite {
        interface CommandContext {
            onCopy?: () => void;
        }
        interface Commands {
            copySelectedModels: typeof copySelectedModelsCommand;
        }
    }
}
//# sourceMappingURL=copy-selected-models.d.ts.map