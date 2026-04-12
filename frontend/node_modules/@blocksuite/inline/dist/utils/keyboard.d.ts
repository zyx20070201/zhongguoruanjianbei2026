import type { InlineEditor } from '../inline-editor.js';
import type { InlineRange } from '../types.js';
import type { BaseTextAttributes } from './base-attributes.js';
export declare const KEYBOARD_PREVENT_DEFAULT = false;
export declare const KEYBOARD_ALLOW_DEFAULT = true;
export interface KeyboardBinding {
    key: number | string | string[];
    handler: KeyboardBindingHandler;
    prefix?: RegExp;
    suffix?: RegExp;
    shortKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
}
export type KeyboardBindingRecord = Record<string, KeyboardBinding>;
export interface KeyboardBindingContext<TextAttributes extends BaseTextAttributes = BaseTextAttributes> {
    inlineRange: InlineRange;
    inlineEditor: InlineEditor<TextAttributes>;
    collapsed: boolean;
    prefixText: string;
    suffixText: string;
    raw: KeyboardEvent;
}
export type KeyboardBindingHandler = (context: KeyboardBindingContext) => typeof KEYBOARD_PREVENT_DEFAULT | typeof KEYBOARD_ALLOW_DEFAULT;
export declare function createInlineKeyDownHandler(inlineEditor: InlineEditor, bindings: KeyboardBindingRecord): (evt: KeyboardEvent) => void;
//# sourceMappingURL=keyboard.d.ts.map