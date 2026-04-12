import { createIdentifier } from '@blocksuite/global/di';
export const ParseDocUrlProvider = createIdentifier('ParseDocUrlService');
export function ParseDocUrlExtension(parseDocUrlService) {
    return {
        setup: di => {
            di.addImpl(ParseDocUrlProvider, parseDocUrlService);
        },
    };
}
//# sourceMappingURL=parse-url-service.js.map