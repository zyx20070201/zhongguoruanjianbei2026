import { BlockHtmlAdapterExtension, } from '@blocksuite/affine-shared/adapters';
export const surfaceBlockHtmlAdapterMatcher = {
    flavour: 'affine:surface',
    toMatch: () => false,
    fromMatch: o => o.node.flavour === 'affine:surface',
    toBlockSnapshot: {},
    fromBlockSnapshot: {
        enter: (_, context) => {
            context.walkerContext.skipAllChildren();
        },
    },
};
export const SurfaceBlockHtmlAdapterExtension = BlockHtmlAdapterExtension(surfaceBlockHtmlAdapterMatcher);
//# sourceMappingURL=html.js.map