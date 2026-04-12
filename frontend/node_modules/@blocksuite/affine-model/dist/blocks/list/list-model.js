import { defineBlockSchema } from '@blocksuite/store';
export const ListBlockSchema = defineBlockSchema({
    flavour: 'affine:list',
    props: internal => ({
        type: 'bulleted',
        text: internal.Text(),
        checked: false,
        collapsed: false,
        // number type only for numbered list
        order: null,
    }),
    metadata: {
        version: 1,
        role: 'content',
        parent: [
            'affine:note',
            'affine:database',
            'affine:list',
            'affine:paragraph',
            'affine:edgeless-text',
        ],
    },
});
//# sourceMappingURL=list-model.js.map