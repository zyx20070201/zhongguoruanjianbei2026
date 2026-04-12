import { BlocksUtils, } from '@blocksuite/blocks';
import { headingKeys } from '../config.js';
export function getNotesFromDoc(doc, modes) {
    const rootModel = doc.root;
    if (!rootModel)
        return [];
    const notes = [];
    rootModel.children.forEach((block, index) => {
        if (!['affine:note'].includes(block.flavour))
            return;
        const blockModel = block;
        const OutlineNoteItem = {
            note: block,
            index,
            number: index + 1,
        };
        if (modes.includes(blockModel.displayMode)) {
            notes.push(OutlineNoteItem);
        }
    });
    return notes;
}
export function isRootBlock(block) {
    return BlocksUtils.matchFlavours(block, ['affine:page']);
}
export function isHeadingBlock(block) {
    return (BlocksUtils.matchFlavours(block, ['affine:paragraph']) &&
        headingKeys.has(block.type$.value));
}
export function getHeadingBlocksFromNote(note, ignoreEmpty = false) {
    const models = note.children.filter(block => {
        const empty = block.text && block.text.length > 0;
        return isHeadingBlock(block) && (!ignoreEmpty || empty);
    });
    return models;
}
export function getHeadingBlocksFromDoc(doc, modes, ignoreEmpty = false) {
    const notes = getNotesFromDoc(doc, modes);
    return notes
        .map(({ note }) => getHeadingBlocksFromNote(note, ignoreEmpty))
        .flat();
}
//# sourceMappingURL=query.js.map