import type { Command } from '@blocksuite/block-std';
export declare const deleteSelectedModelsCommand: Command<'selectedModels'>;
declare global {
    namespace BlockSuite {
        interface Commands {
            deleteSelectedModels: typeof deleteSelectedModelsCommand;
        }
    }
}
//# sourceMappingURL=delete-selected-models.d.ts.map