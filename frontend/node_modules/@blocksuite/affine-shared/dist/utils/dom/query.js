import { BLOCK_ID_ATTR } from '@blocksuite/block-std';
const ATTR_SELECTOR = `[${BLOCK_ID_ATTR}]`;
export function getModelByElement(element) {
    const closestBlock = element.closest(ATTR_SELECTOR);
    if (!closestBlock) {
        return null;
    }
    return closestBlock.model;
}
export function getRootByElement(element) {
    const pageRoot = getPageRootByElement(element);
    if (pageRoot)
        return pageRoot;
    const edgelessRoot = getEdgelessRootByElement(element);
    if (edgelessRoot)
        return edgelessRoot;
    return null;
}
export function getPageRootByElement(element) {
    return element.closest('affine-page-root');
}
export function getEdgelessRootByElement(element) {
    return element.closest('affine-edgeless-root');
}
//# sourceMappingURL=query.js.map