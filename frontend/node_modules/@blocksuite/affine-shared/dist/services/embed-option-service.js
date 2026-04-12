import { Extension } from '@blocksuite/block-std';
import { createIdentifier } from '@blocksuite/global/di';
export const EmbedOptionProvider = createIdentifier('AffineEmbedOptionProvider');
export class EmbedOptionService extends Extension {
    constructor() {
        super(...arguments);
        this._embedBlockRegistry = new Set();
        this.getEmbedBlockOptions = (url) => {
            const entries = this._embedBlockRegistry.entries();
            for (const [options] of entries) {
                const regex = options.urlRegex;
                if (regex.test(url))
                    return options;
            }
            return null;
        };
        this.registerEmbedBlockOptions = (options) => {
            this._embedBlockRegistry.add(options);
        };
    }
    static setup(di) {
        di.addImpl(EmbedOptionProvider, EmbedOptionService);
    }
}
//# sourceMappingURL=embed-option-service.js.map