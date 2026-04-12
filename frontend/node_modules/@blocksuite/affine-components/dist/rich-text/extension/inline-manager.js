import { StdIdentifier, } from '@blocksuite/block-std';
import { createIdentifier, } from '@blocksuite/global/di';
import { baseTextAttributes, getDefaultAttributeRenderer, KEYBOARD_ALLOW_DEFAULT, } from '@blocksuite/inline';
import { z } from 'zod';
import { MarkdownMatcherIdentifier } from './markdown-matcher.js';
export class InlineManager {
    constructor(std, markdownMatches, ...specs) {
        this.std = std;
        this.markdownMatches = markdownMatches;
        this.embedChecker = (delta) => {
            for (const spec of this.specs) {
                if (spec.embed && spec.match(delta)) {
                    return true;
                }
            }
            return false;
        };
        this.getRenderer = () => {
            const defaultRenderer = getDefaultAttributeRenderer();
            const renderer = props => {
                // Priority increases from front to back
                for (const spec of this.specs.toReversed()) {
                    if (spec.match(props.delta)) {
                        return spec.renderer(props);
                    }
                }
                return defaultRenderer(props);
            };
            return renderer;
        };
        this.getSchema = () => {
            const defaultSchema = baseTextAttributes;
            const schema = this.specs.reduce((acc, cur) => {
                const currentSchema = z.object({
                    [cur.name]: cur.schema,
                });
                return acc.merge(currentSchema);
            }, defaultSchema);
            return schema;
        };
        this.markdownShortcutHandler = (context, undoManager) => {
            const { inlineEditor, prefixText, inlineRange } = context;
            for (const match of this.markdownMatches) {
                const matchedText = prefixText.match(match.pattern);
                if (matchedText) {
                    return match.action({
                        inlineEditor,
                        prefixText,
                        inlineRange,
                        pattern: match.pattern,
                        undoManager,
                    });
                }
            }
            return KEYBOARD_ALLOW_DEFAULT;
        };
        this.specs = specs;
    }
}
export const InlineManagerIdentifier = createIdentifier('AffineInlineManager');
export function InlineManagerExtension({ id, enableMarkdown = true, specs, }) {
    const identifier = InlineManagerIdentifier(id);
    return {
        setup: di => {
            di.addImpl(identifier, provider => {
                return new InlineManager(provider.get(StdIdentifier), enableMarkdown
                    ? Array.from(provider.getAll(MarkdownMatcherIdentifier).values())
                    : [], ...specs.map(spec => provider.get(spec)));
            });
        },
        identifier,
    };
}
//# sourceMappingURL=inline-manager.js.map