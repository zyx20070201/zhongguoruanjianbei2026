import { matchFlavours } from './checker.js';
/**
 * Pass in a list model, and this function will look forward to find continuous sibling numbered lists,
 * typically used for updating list numbers. The result not contains the list passed in.
 */
export function getNextContinuousNumberedLists(doc, modelOrId) {
    const model = typeof modelOrId === 'string' ? doc.getBlock(modelOrId)?.model : modelOrId;
    if (!model)
        return [];
    const parent = doc.getParent(model);
    if (!parent)
        return [];
    const modelIndex = parent.children.indexOf(model);
    if (modelIndex === -1)
        return [];
    const firstNotNumberedListIndex = parent.children.findIndex((model, i) => i > modelIndex &&
        (!matchFlavours(model, ['affine:list']) || model.type !== 'numbered'));
    const newContinuousLists = parent.children.slice(modelIndex + 1, firstNotNumberedListIndex === -1 ? undefined : firstNotNumberedListIndex);
    if (!newContinuousLists.every(model => matchFlavours(model, ['affine:list']) && model.type === 'numbered'))
        return [];
    return newContinuousLists;
}
export function toNumberedList(std, model, order) {
    const { doc } = std;
    if (!model.text)
        return;
    const parent = doc.getParent(model);
    if (!parent)
        return;
    const index = parent.children.indexOf(model);
    const prevSibling = doc.getPrev(model);
    let realOrder = order;
    // if there is a numbered list before, the order continues from the previous list
    if (prevSibling &&
        matchFlavours(prevSibling, ['affine:list']) &&
        prevSibling.type === 'numbered') {
        doc.transact(() => {
            if (!prevSibling.order)
                prevSibling.order = 1;
            realOrder = prevSibling.order + 1;
        });
    }
    // add a new list block and delete the current block
    const newListId = doc.addBlock('affine:list', {
        type: 'numbered',
        text: model.text.clone(),
        order: realOrder,
    }, parent, index);
    const newList = doc.getBlock(newListId)?.model;
    if (!newList) {
        return;
    }
    doc.deleteBlock(model, {
        deleteChildren: false,
        bringChildrenTo: newList,
    });
    // if there is a numbered list following, correct their order to keep them continuous
    const nextContinuousNumberedLists = getNextContinuousNumberedLists(doc, newList);
    let base = realOrder + 1;
    nextContinuousNumberedLists.forEach(list => {
        doc.transact(() => {
            list.order = base;
        });
        base += 1;
    });
    return newList.id;
}
//# sourceMappingURL=list.js.map