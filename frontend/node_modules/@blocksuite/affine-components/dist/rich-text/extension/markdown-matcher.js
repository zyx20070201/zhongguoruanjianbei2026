import { createIdentifier, } from '@blocksuite/global/di';
export const MarkdownMatcherIdentifier = createIdentifier('AffineMarkdownMatcher');
export function InlineMarkdownExtension(matcher) {
    const identifier = MarkdownMatcherIdentifier(matcher.name);
    return {
        setup: di => {
            di.addImpl(identifier, () => ({ ...matcher }));
        },
        identifier,
    };
}
//# sourceMappingURL=markdown-matcher.js.map