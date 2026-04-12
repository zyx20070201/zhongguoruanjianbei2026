import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import { intersectInlineRange } from '../utils/inline-range.js';
export class InlineTextService {
    get yText() {
        return this.editor.yText;
    }
    constructor(editor) {
        this.editor = editor;
        this.deleteText = (inlineRange) => {
            if (this.editor.isReadonly)
                return;
            this.transact(() => {
                this.yText.delete(inlineRange.index, inlineRange.length);
            });
        };
        this.formatText = (inlineRange, attributes, options = {}) => {
            if (this.editor.isReadonly)
                return;
            const { match = () => true, mode = 'merge' } = options;
            const deltas = this.editor.deltaService.getDeltasByInlineRange(inlineRange);
            deltas
                .filter(([delta, deltaInlineRange]) => match(delta, deltaInlineRange))
                .forEach(([_delta, deltaInlineRange]) => {
                const normalizedAttributes = this.editor.attributeService.normalizeAttributes(attributes);
                if (!normalizedAttributes)
                    return;
                const targetInlineRange = intersectInlineRange(inlineRange, deltaInlineRange);
                if (!targetInlineRange)
                    return;
                if (mode === 'replace') {
                    this.resetText(targetInlineRange);
                }
                this.transact(() => {
                    this.yText.format(targetInlineRange.index, targetInlineRange.length, normalizedAttributes);
                });
            });
        };
        this.insertLineBreak = (inlineRange) => {
            if (this.editor.isReadonly)
                return;
            this.transact(() => {
                this.yText.delete(inlineRange.index, inlineRange.length);
                this.yText.insert(inlineRange.index, '\n');
            });
        };
        this.insertText = (inlineRange, text, attributes = {}) => {
            if (this.editor.isReadonly)
                return;
            if (this.editor.attributeService.marks) {
                attributes = { ...attributes, ...this.editor.attributeService.marks };
            }
            const normalizedAttributes = this.editor.attributeService.normalizeAttributes(attributes);
            if (!text || !text.length) {
                throw new BlockSuiteError(ErrorCode.InlineEditorError, 'text must not be empty');
            }
            this.transact(() => {
                this.yText.delete(inlineRange.index, inlineRange.length);
                this.yText.insert(inlineRange.index, text, normalizedAttributes);
            });
        };
        this.resetText = (inlineRange) => {
            if (this.editor.isReadonly)
                return;
            const coverDeltas = [];
            for (let i = inlineRange.index; i <= inlineRange.index + inlineRange.length; i++) {
                const delta = this.editor.getDeltaByRangeIndex(i);
                if (delta) {
                    coverDeltas.push(delta);
                }
            }
            const unset = Object.fromEntries(coverDeltas.flatMap(delta => delta.attributes
                ? Object.keys(delta.attributes).map(key => [key, null])
                : []));
            this.transact(() => {
                this.yText.format(inlineRange.index, inlineRange.length, {
                    ...unset,
                });
            });
        };
        this.setText = (text, attributes = {}) => {
            if (this.editor.isReadonly)
                return;
            this.transact(() => {
                this.yText.delete(0, this.yText.length);
                this.yText.insert(0, text, attributes);
            });
        };
        this.transact = this.editor.transact;
    }
}
//# sourceMappingURL=text.js.map