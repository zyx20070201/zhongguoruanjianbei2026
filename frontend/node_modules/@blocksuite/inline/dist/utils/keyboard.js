import { IS_IOS, IS_MAC } from '@blocksuite/global/env';
const SHORT_KEY_PROPERTY = IS_IOS || IS_MAC ? 'metaKey' : 'ctrlKey';
export const KEYBOARD_PREVENT_DEFAULT = false;
export const KEYBOARD_ALLOW_DEFAULT = true;
export function createInlineKeyDownHandler(inlineEditor, bindings) {
    const bindingStore = {};
    function normalize(binding) {
        if (binding.shortKey) {
            binding[SHORT_KEY_PROPERTY] = binding.shortKey;
            delete binding.shortKey;
        }
        return binding;
    }
    function keyMatch(evt, binding) {
        if (['altKey', 'ctrlKey', 'metaKey', 'shiftKey'].some(key => Object.hasOwn(binding, key) && binding[key] !== evt[key])) {
            return false;
        }
        return binding.key === evt.key;
    }
    function addBinding(keyBinding) {
        const binding = normalize(keyBinding);
        const keys = Array.isArray(binding.key) ? binding.key : [binding.key];
        keys.forEach(key => {
            const singleBinding = {
                ...binding,
                key,
            };
            bindingStore[key] = bindingStore[key] ?? [];
            bindingStore[key].push(singleBinding);
        });
    }
    Object.values(bindings).forEach(binding => {
        addBinding(binding);
    });
    function keyDownHandler(evt) {
        if (evt.defaultPrevented || evt.isComposing)
            return;
        const keyBindings = bindingStore[evt.key] ?? [];
        const keyMatches = keyBindings.filter(binding => keyMatch(evt, binding));
        if (keyMatches.length === 0)
            return;
        const inlineRange = inlineEditor.getInlineRange();
        if (!inlineRange)
            return;
        const startTextPoint = inlineEditor.getTextPoint(inlineRange.index);
        if (!startTextPoint)
            return;
        const [leafStart, offsetStart] = startTextPoint;
        let leafEnd;
        let offsetEnd;
        if (inlineRange.length === 0) {
            leafEnd = leafStart;
            offsetEnd = offsetStart;
        }
        else {
            const endTextPoint = inlineEditor.getTextPoint(inlineRange.index + inlineRange.length);
            if (!endTextPoint)
                return;
            [leafEnd, offsetEnd] = endTextPoint;
        }
        const prefixText = leafStart.textContent
            ? leafStart.textContent.slice(0, offsetStart)
            : '';
        const suffixText = leafEnd.textContent
            ? leafEnd.textContent.slice(offsetEnd)
            : '';
        const currContext = {
            inlineRange,
            inlineEditor: inlineEditor,
            collapsed: inlineRange.length === 0,
            prefixText,
            suffixText,
            raw: evt,
        };
        const prevented = keyMatches.some(binding => {
            if (binding.prefix && !binding.prefix.test(currContext.prefixText)) {
                return false;
            }
            if (binding.suffix && !binding.suffix.test(currContext.suffixText)) {
                return false;
            }
            return binding.handler(currContext) === KEYBOARD_PREVENT_DEFAULT;
        });
        if (prevented) {
            evt.preventDefault();
        }
    }
    return keyDownHandler;
}
//# sourceMappingURL=keyboard.js.map