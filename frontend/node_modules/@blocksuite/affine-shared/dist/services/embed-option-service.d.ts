import type { EmbedCardStyle } from '@blocksuite/affine-model';
import type { Container } from '@blocksuite/global/di';
import { Extension } from '@blocksuite/block-std';
export type EmbedOptions = {
    flavour: string;
    urlRegex: RegExp;
    styles: EmbedCardStyle[];
    viewType: 'card' | 'embed';
};
export interface EmbedOptionProvider {
    getEmbedBlockOptions(url: string): EmbedOptions | null;
    registerEmbedBlockOptions(options: EmbedOptions): void;
}
export declare const EmbedOptionProvider: import("@blocksuite/global/di").ServiceIdentifier<EmbedOptionProvider> & ((variant: import("@blocksuite/global/di").ServiceVariant) => import("@blocksuite/global/di").ServiceIdentifier<EmbedOptionProvider>);
export declare class EmbedOptionService extends Extension implements EmbedOptionProvider {
    private _embedBlockRegistry;
    getEmbedBlockOptions: (url: string) => EmbedOptions | null;
    registerEmbedBlockOptions: (options: EmbedOptions) => void;
    static setup(di: Container): void;
}
//# sourceMappingURL=embed-option-service.d.ts.map