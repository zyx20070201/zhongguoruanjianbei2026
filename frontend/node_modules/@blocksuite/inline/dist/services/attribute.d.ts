import type { z, ZodTypeDef } from 'zod';
import type { InlineEditor } from '../inline-editor.js';
import type { AttributeRenderer, InlineRange } from '../types.js';
import type { BaseTextAttributes } from '../utils/index.js';
export declare class AttributeService<TextAttributes extends BaseTextAttributes> {
    readonly editor: InlineEditor<TextAttributes>;
    private _attributeRenderer;
    private _attributeSchema;
    private _marks;
    getFormat: (inlineRange: InlineRange, loose?: boolean) => TextAttributes;
    normalizeAttributes: (textAttributes?: TextAttributes) => TextAttributes | undefined;
    resetMarks: () => void;
    setAttributeRenderer: (renderer: AttributeRenderer<TextAttributes>) => void;
    setAttributeSchema: (schema: z.ZodSchema<TextAttributes, ZodTypeDef, unknown>) => void;
    setMarks: (marks: TextAttributes) => void;
    get attributeRenderer(): AttributeRenderer<TextAttributes>;
    get marks(): TextAttributes | null;
    constructor(editor: InlineEditor<TextAttributes>);
}
//# sourceMappingURL=attribute.d.ts.map