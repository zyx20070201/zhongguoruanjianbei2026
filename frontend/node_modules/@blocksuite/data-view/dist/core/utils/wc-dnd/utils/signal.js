import { computed } from '@preact/signals-core';
export const computedCache = (cb) => {
    let value;
    const result = computed(() => {
        return (value = cb());
    });
    Object.defineProperty(result, 'preValue', {
        get() {
            return value;
        },
    });
    return result;
};
//# sourceMappingURL=signal.js.map