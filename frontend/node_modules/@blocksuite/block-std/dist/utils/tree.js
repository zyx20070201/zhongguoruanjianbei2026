import { isGfxGroupCompatibleModel, } from '../gfx/model/base.js';
/**
 * Get the top elements from the list of elements, which are in some tree structures.
 *
 * For example: a list `[G1, E1, G2, E2, E3, E4, G4, E5, E6]`,
 * and they are in the elements tree like:
 * ```
 *     G1         G4      E6
 *    /  \        |
 *  E1   G2       E5
 *       / \
 *      E2  G3*
 *         / \
 *        E3 E4
 * ```
 * where the star symbol `*` denote it is not in the list.
 *
 * The result should be `[G1, G4, E6]`
 */
export function getTopElements(elements) {
    const results = new Set(elements);
    elements = [...new Set(elements)];
    elements.forEach(e1 => {
        elements.forEach(e2 => {
            if (isGfxGroupCompatibleModel(e1) && e1.hasDescendant(e2)) {
                results.delete(e2);
            }
        });
    });
    return [...results];
}
function traverse(element, preCallback, postCallBack) {
    // avoid infinite loop caused by circular reference
    const visited = new Set();
    const innerTraverse = (element) => {
        if (visited.has(element))
            return;
        visited.add(element);
        if (preCallback) {
            const interrupt = preCallback(element);
            if (interrupt)
                return;
        }
        if (isGfxGroupCompatibleModel(element)) {
            element.childElements.forEach(child => {
                innerTraverse(child);
            });
        }
        postCallBack && postCallBack(element);
    };
    innerTraverse(element);
}
export function descendantElementsImpl(container) {
    const results = [];
    container.childElements.forEach(child => {
        traverse(child, element => {
            results.push(element);
        });
    });
    return results;
}
export function hasDescendantElementImpl(container, element) {
    let _container = element.group;
    while (_container) {
        if (_container === container)
            return true;
        _container = _container.group;
    }
    return false;
}
/**
 * This checker is used to prevent circular reference, when adding a child element to a container.
 */
export function canSafeAddToContainer(container, element) {
    if (element === container ||
        (isGfxGroupCompatibleModel(element) && element.hasDescendant(container))) {
        return false;
    }
    return true;
}
export function isLockedByAncestorImpl(element) {
    return element.groups.some(isLockedBySelfImpl);
}
export function isLockedBySelfImpl(element) {
    return element.lockedBySelf ?? false;
}
export function isLockedImpl(element) {
    return isLockedBySelfImpl(element) || isLockedByAncestorImpl(element);
}
export function lockElementImpl(doc, element) {
    doc.transact(() => {
        element.lockedBySelf = true;
    });
}
export function unlockElementImpl(doc, element) {
    doc.transact(() => {
        element.lockedBySelf = false;
    });
}
//# sourceMappingURL=tree.js.map