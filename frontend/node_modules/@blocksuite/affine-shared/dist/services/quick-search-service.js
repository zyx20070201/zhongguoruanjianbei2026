import { createIdentifier } from '@blocksuite/global/di';
export const QuickSearchProvider = createIdentifier('AffineQuickSearchService');
export function QuickSearchExtension(quickSearchService) {
    return {
        setup: di => {
            di.addImpl(QuickSearchProvider, quickSearchService);
        },
    };
}
//# sourceMappingURL=quick-search-service.js.map