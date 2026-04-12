import { createIdentifier, } from '@blocksuite/global/di';
export const BlockNotionHtmlAdapterMatcherIdentifier = createIdentifier('BlockNotionHtmlAdapterMatcher');
export function BlockNotionHtmlAdapterExtension(matcher) {
    const identifier = BlockNotionHtmlAdapterMatcherIdentifier(matcher.flavour);
    return {
        setup: di => {
            di.addImpl(identifier, () => matcher);
        },
        identifier,
    };
}
//# sourceMappingURL=block-adapter.js.map