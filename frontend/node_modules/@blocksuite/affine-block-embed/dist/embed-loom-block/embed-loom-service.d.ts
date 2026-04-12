import { type EmbedLoomModel } from '@blocksuite/affine-model';
import { BlockService } from '@blocksuite/block-std';
export declare class EmbedLoomBlockService extends BlockService {
    static readonly flavour: `affine:embed-${string}`;
    private static readonly linkPreviewer;
    static setLinkPreviewEndpoint: (endpoint: string) => void;
    queryUrlData: (embedLoomModel: EmbedLoomModel, signal?: AbortSignal) => Promise<Partial<import("@blocksuite/affine-model").EmbedLoomBlockUrlData>>;
    mounted(): void;
}
//# sourceMappingURL=embed-loom-service.d.ts.map