import { asyncGetBlockComponent, matchFlavours, } from '@blocksuite/affine-shared/utils';
/**
 * In most cases, you not need RichText, you can use {@link getInlineEditorByModel} instead.
 */
export function getRichTextByModel(editorHost, id) {
    const blockComponent = editorHost.view.getBlock(id);
    const richText = blockComponent?.querySelector('rich-text');
    if (!richText)
        return null;
    return richText;
}
export async function asyncGetRichText(editorHost, id) {
    const blockComponent = await asyncGetBlockComponent(editorHost, id);
    if (!blockComponent)
        return null;
    await blockComponent.updateComplete;
    const richText = blockComponent?.querySelector('rich-text');
    if (!richText)
        return null;
    return richText;
}
export function getInlineEditorByModel(editorHost, model) {
    const blockModel = typeof model === 'string'
        ? editorHost.std.doc.getBlock(model)?.model
        : model;
    // @ts-ignore TODO: migrate database model to `@blocksuite/affine-model`
    if (!blockModel || matchFlavours(blockModel, ['affine:database'])) {
        // Not support database model since it's may be have multiple inline editor instances.
        // Support to enter the editing state through the Enter key in the database.
        return null;
    }
    const richText = getRichTextByModel(editorHost, blockModel.id);
    if (!richText)
        return null;
    return richText.inlineEditor;
}
export async function asyncSetInlineRange(editorHost, model, inlineRange) {
    const richText = await asyncGetRichText(editorHost, model.id);
    if (!richText) {
        return;
    }
    await richText.updateComplete;
    const inlineEditor = richText.inlineEditor;
    if (!inlineEditor) {
        return;
    }
    inlineEditor.setInlineRange(inlineRange);
}
export function focusTextModel(std, id, offset = 0) {
    selectTextModel(std, id, offset);
}
export function selectTextModel(std, id, index = 0, length = 0) {
    const { selection } = std;
    selection.setGroup('note', [
        selection.create('text', {
            from: { blockId: id, index, length },
            to: null,
        }),
    ]);
}
//# sourceMappingURL=dom.js.map