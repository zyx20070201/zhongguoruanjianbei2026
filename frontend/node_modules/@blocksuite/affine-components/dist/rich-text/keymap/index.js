import { textCommonKeymap } from './basic.js';
import { bracketKeymap } from './bracket.js';
import { textFormatKeymap } from './format.js';
export const textKeymap = (std) => {
    return {
        ...textCommonKeymap(std),
        ...textFormatKeymap(std),
        ...bracketKeymap(std),
    };
};
//# sourceMappingURL=index.js.map