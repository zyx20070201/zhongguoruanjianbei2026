import { defineBlockSchema, } from '@blocksuite/store';
export const CodeBlockSchema = defineBlockSchema({
    flavour: 'affine:code',
    props: internal => ({
        text: internal.Text(),
        language: null,
        wrap: false,
        caption: '',
    }),
    metadata: {
        version: 1,
        role: 'content',
        parent: [
            'affine:note',
            'affine:paragraph',
            'affine:list',
            'affine:edgeless-text',
        ],
        children: [],
    },
});
//# sourceMappingURL=code-model.js.map