import { createIdentifier, } from '@blocksuite/global/di';
export const BlockHtmlAdapterMatcherIdentifier = createIdentifier('BlockHtmlAdapterMatcher');
export function BlockHtmlAdapterExtension(matcher) {
    const identifier = BlockHtmlAdapterMatcherIdentifier(matcher.flavour);
    return {
        setup: di => {
            di.addImpl(identifier, () => matcher);
        },
        identifier,
    };
}
//# sourceMappingURL=block-adapter.js.map