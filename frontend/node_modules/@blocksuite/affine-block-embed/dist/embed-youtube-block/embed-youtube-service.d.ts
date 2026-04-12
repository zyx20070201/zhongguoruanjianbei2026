import { type EmbedYoutubeModel } from '@blocksuite/affine-model';
import { BlockService } from '@blocksuite/block-std';
export declare class EmbedYoutubeBlockService extends BlockService {
    static readonly flavour: `affine:embed-${string}`;
    private static readonly linkPreviewer;
    static setLinkPreviewEndpoint: (endpoint: string) => void;
    queryUrlData: (embedYoutubeModel: EmbedYoutubeModel, signal?: AbortSignal) => Promise<Partial<import("@blocksuite/affine-model").EmbedYoutubeBlockUrlData>>;
    mounted(): void;
}
//# sourceMappingURL=embed-youtube-service.d.ts.map