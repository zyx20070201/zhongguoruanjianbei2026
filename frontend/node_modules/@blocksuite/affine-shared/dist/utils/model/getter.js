import { NoteDisplayMode } from '@blocksuite/affine-model';
import { matchFlavours } from './checker.js';
export function findAncestorModel(model, match) {
    let curModel = model;
    while (curModel) {
        if (match(curModel)) {
            return curModel;
        }
        curModel = curModel.parent;
    }
    return null;
}
/**
 * Get block component by its model and wait for the doc element to finish updating.
 *
 */
export async function asyncGetBlockComponent(editorHost, id) {
    const rootBlockId = editorHost.doc.root?.id;
    if (!rootBlockId)
        return null;
    const rootComponent = editorHost.view.getBlock(rootBlockId);
    if (!rootComponent)
        return null;
    await rootComponent.updateComplete;
    return editorHost.view.getBlock(id);
}
export function findNoteBlockModel(model) {
    return findAncestorModel(model, m => matchFlavours(m, ['affine:note']));
}
export function getLastNoteBlock(doc) {
    let note = null;
    if (!doc.root)
        return null;
    const { children } = doc.root;
    for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (matchFlavours(child, ['affine:note']) &&
            child.displayMode !== NoteDisplayMode.EdgelessOnly) {
            note = child;
            break;
        }
    }
    return note;
}
//# sourceMappingURL=getter.js.map