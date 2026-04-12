import { typeSystem } from '../../logical/index.js';
import { allLiteralConfig } from './define.js';
export const literalItemsMatcher = {
    getItems: (type, value, onChange) => {
        for (const config of allLiteralConfig) {
            if (typeSystem.unify(type, config.type)) {
                return config.getItems(type, value, onChange);
            }
        }
        return [];
    },
};
//# sourceMappingURL=matcher.js.map