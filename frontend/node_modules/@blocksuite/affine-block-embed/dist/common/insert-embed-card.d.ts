import type { EmbedCardStyle } from '@blocksuite/affine-model';
import type { BlockStdScope } from '@blocksuite/block-std';
interface EmbedCardProperties {
    flavour: string;
    targetStyle: EmbedCardStyle;
    props: Record<string, unknown>;
}
export declare function insertEmbedCard(std: BlockStdScope, properties: EmbedCardProperties): void;
export {};
//# sourceMappingURL=insert-embed-card.d.ts.map