import { ParagraphBlockSchema } from '@blocksuite/affine-model';
import { BlockPlainTextAdapterExtension, } from '@blocksuite/affine-shared/adapters';
export const paragraphBlockPlainTextAdapterMatcher = {
    flavour: ParagraphBlockSchema.model.flavour,
    toMatch: () => false,
    fromMatch: o => o.node.flavour === ParagraphBlockSchema.model.flavour,
    toBlockSnapshot: {},
    fromBlockSnapshot: {
        enter: (o, context) => {
            const text = (o.node.props.text ?? { delta: [] });
            const { deltaConverter } = context;
            const buffer = deltaConverter.deltaToAST(text.delta).join('');
            context.textBuffer.content += buffer;
            context.textBuffer.content += '\n';
        },
    },
};
export const ParagraphBlockPlainTextAdapterExtension = BlockPlainTextAdapterExtension(paragraphBlockPlainTextAdapterMatcher);
//# sourceMappingURL=plain-text.js.map