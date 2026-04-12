import type { Command } from '@blocksuite/block-std';
import { type BlockModel, type DraftModel } from '@blocksuite/store';
export declare const draftSelectedModelsCommand: Command<'selectedModels', 'draftedModels'>;
declare global {
    namespace BlockSuite {
        interface CommandContext {
            draftedModels?: Promise<DraftModel<BlockModel<object>>[]>;
        }
        interface Commands {
            draftSelectedModels: typeof draftSelectedModelsCommand;
        }
    }
}
//# sourceMappingURL=draft-selected-models.d.ts.map