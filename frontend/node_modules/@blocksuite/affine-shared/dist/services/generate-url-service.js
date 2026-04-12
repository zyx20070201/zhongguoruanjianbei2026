import { createIdentifier } from '@blocksuite/global/di';
export const GenerateDocUrlProvider = createIdentifier('GenerateDocUrlService');
export function GenerateDocUrlExtension(generateDocUrlProvider) {
    return {
        setup: di => {
            di.addImpl(GenerateDocUrlProvider, generateDocUrlProvider);
        },
    };
}
//# sourceMappingURL=generate-url-service.js.map