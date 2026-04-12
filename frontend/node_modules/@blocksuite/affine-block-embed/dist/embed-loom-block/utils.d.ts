import type { EmbedLoomBlockUrlData, EmbedLoomModel } from '@blocksuite/affine-model';
import type { EmbedLoomBlockComponent } from './embed-loom-block.js';
export declare function queryEmbedLoomData(embedLoomModel: EmbedLoomModel, signal?: AbortSignal): Promise<Partial<EmbedLoomBlockUrlData>>;
export declare function queryLoomOEmbedData(url: string, signal?: AbortSignal): Promise<Partial<EmbedLoomBlockUrlData>>;
export declare function refreshEmbedLoomUrlData(embedLoomElement: EmbedLoomBlockComponent, signal?: AbortSignal): Promise<void>;
//# sourceMappingURL=utils.d.ts.map