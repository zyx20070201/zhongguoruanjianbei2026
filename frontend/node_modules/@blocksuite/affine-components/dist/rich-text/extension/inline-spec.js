import { createIdentifier, } from '@blocksuite/global/di';
export const InlineSpecIdentifier = createIdentifier('AffineInlineSpec');
export function InlineSpecExtension(nameOrSpec, getSpec) {
    if (typeof nameOrSpec === 'string') {
        const identifier = InlineSpecIdentifier(nameOrSpec);
        return {
            identifier,
            setup: di => {
                di.addImpl(identifier, provider => getSpec(provider));
            },
        };
    }
    const identifier = InlineSpecIdentifier(nameOrSpec.name);
    return {
        identifier,
        setup: di => {
            di.addImpl(identifier, nameOrSpec);
        },
    };
}
//# sourceMappingURL=inline-spec.js.map