import isMatch from 'lodash.ismatch';
import { BlockViewType } from './consts.js';
export function runQuery(query, block) {
    const blockViewType = getBlockViewType(query, block);
    block.blockViewType = blockViewType;
    if (blockViewType !== BlockViewType.Hidden) {
        const queryMode = query.mode;
        setAncestorsToDisplayIfHidden(queryMode, block);
    }
}
function getBlockViewType(query, block) {
    const flavour = block.model.flavour;
    const id = block.model.id;
    const queryMode = query.mode;
    const props = block.model.keys.reduce((acc, key) => {
        return {
            ...acc,
            [key]: block.model[key],
        };
    }, {});
    let blockViewType = queryMode === 'loose' ? BlockViewType.Display : BlockViewType.Hidden;
    query.match.some(queryObject => {
        const { id: queryId, flavour: queryFlavour, props: queryProps, viewType, } = queryObject;
        const matchQueryId = queryId == null ? true : queryId === id;
        const matchQueryFlavour = queryFlavour == null ? true : queryFlavour === flavour;
        const matchQueryProps = queryProps == null ? true : isMatch(props, queryProps);
        if (matchQueryId && matchQueryFlavour && matchQueryProps) {
            blockViewType = viewType;
            return true;
        }
        return false;
    });
    return blockViewType;
}
function setAncestorsToDisplayIfHidden(mode, block) {
    const doc = block.model.doc;
    let parent = doc.getParent(block.model);
    while (parent) {
        const parentBlock = doc.getBlock(parent.id);
        if (parentBlock && parentBlock.blockViewType === BlockViewType.Hidden) {
            parentBlock.blockViewType =
                mode === 'include' ? BlockViewType.Display : BlockViewType.Bypass;
        }
        parent = doc.getParent(parent);
    }
}
//# sourceMappingURL=query.js.map