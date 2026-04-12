import { BLOCK_ID_ATTR, } from '@blocksuite/block-std';
import { INLINE_ROOT_ATTR } from '@blocksuite/inline';
import { FORMAT_NATIVE_SUPPORT_FLAVOURS } from './consts.js';
// for native range
export const formatNativeCommand = (ctx, next) => {
    const { styles, mode = 'merge' } = ctx;
    let range = ctx.range;
    if (!range) {
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0)
            return;
        range = selection.getRangeAt(0);
    }
    if (!range)
        return;
    const selectedInlineEditors = Array.from(ctx.std.host.querySelectorAll(`[${INLINE_ROOT_ATTR}]`))
        .filter(el => range?.intersectsNode(el))
        .filter(el => {
        const block = el.closest(`[${BLOCK_ID_ATTR}]`);
        if (block) {
            return FORMAT_NATIVE_SUPPORT_FLAVOURS.includes(block.model.flavour);
        }
        return false;
    })
        .map(el => el.inlineEditor);
    selectedInlineEditors.forEach(inlineEditor => {
        const inlineRange = inlineEditor.getInlineRange();
        if (!inlineRange)
            return;
        inlineEditor.formatText(inlineRange, styles, {
            mode,
        });
    });
    next();
};
//# sourceMappingURL=format-native.js.map