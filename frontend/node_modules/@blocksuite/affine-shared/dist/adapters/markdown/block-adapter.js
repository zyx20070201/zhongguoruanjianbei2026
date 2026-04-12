import { createIdentifier, } from '@blocksuite/global/di';
export const BlockMarkdownAdapterMatcherIdentifier = createIdentifier('BlockMarkdownAdapterMatcher');
export function BlockMarkdownAdapterExtension(matcher) {
    const identifier = BlockMarkdownAdapterMatcherIdentifier(matcher.flavour);
    return {
        setup: di => {
            di.addImpl(identifier, () => matcher);
        },
        identifier,
    };
}
//# sourceMappingURL=block-adapter.js.map