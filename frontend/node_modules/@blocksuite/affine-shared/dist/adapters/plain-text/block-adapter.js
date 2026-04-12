import { createIdentifier, } from '@blocksuite/global/di';
export const BlockPlainTextAdapterMatcherIdentifier = createIdentifier('BlockPlainTextAdapterMatcher');
export function BlockPlainTextAdapterExtension(matcher) {
    const identifier = BlockPlainTextAdapterMatcherIdentifier(matcher.flavour);
    return {
        setup: di => {
            di.addImpl(identifier, () => matcher);
        },
        identifier,
    };
}
//# sourceMappingURL=block-adapter.js.map