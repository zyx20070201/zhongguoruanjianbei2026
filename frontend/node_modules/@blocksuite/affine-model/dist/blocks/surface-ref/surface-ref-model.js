import { defineBlockSchema } from '@blocksuite/store';
export const SurfaceRefBlockSchema = defineBlockSchema({
    flavour: 'affine:surface-ref',
    props: () => ({
        reference: '',
        caption: '',
    }),
    metadata: {
        version: 1,
        role: 'content',
        parent: ['affine:note', 'affine:paragraph', 'affine:list'],
    },
});
//# sourceMappingURL=surface-ref-model.js.map