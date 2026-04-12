import { toNumberedList } from '@blocksuite/affine-shared/utils';
export const convertToNumberedListCommand = (ctx, next) => {
    const { std, id, order, stopCapturing = true } = ctx;
    const host = std.host;
    const doc = host.doc;
    const model = doc.getBlock(id)?.model;
    if (!model || !model.text)
        return;
    if (stopCapturing)
        host.doc.captureSync();
    const listConvertedId = toNumberedList(std, model, order);
    if (!listConvertedId)
        return;
    return next({ listConvertedId });
};
//# sourceMappingURL=convert-to-numbered-list.js.map