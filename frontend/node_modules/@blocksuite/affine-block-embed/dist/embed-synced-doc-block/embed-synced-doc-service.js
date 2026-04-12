import { EmbedSyncedDocBlockSchema } from '@blocksuite/affine-model';
import { BlockService } from '@blocksuite/block-std';
export class EmbedSyncedDocBlockService extends BlockService {
    static { this.flavour = EmbedSyncedDocBlockSchema.model.flavour; }
}
//# sourceMappingURL=embed-synced-doc-service.js.map