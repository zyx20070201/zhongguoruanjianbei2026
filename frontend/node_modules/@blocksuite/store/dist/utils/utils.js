import { SYS_KEYS } from '../consts.js';
import { native2Y } from '../reactive/index.js';
import { internalPrimitives } from '../schema/base.js';
export function syncBlockProps(schema, model, yBlock, props) {
    const defaultProps = schema.model.props?.(internalPrimitives) ?? {};
    Object.entries(props).forEach(([key, value]) => {
        if (SYS_KEYS.has(key))
            return;
        if (value === undefined)
            return;
        // @ts-ignore
        model[key] = value;
    });
    // set default value
    Object.entries(defaultProps).forEach(([key, value]) => {
        const notExists = !yBlock.has(`prop:${key}`) || yBlock.get(`prop:${key}`) === undefined;
        if (!notExists) {
            return;
        }
        // @ts-ignore
        model[key] = native2Y(value);
    });
}
export const hash = (str) => {
    return str
        .split('')
        .reduce((prevHash, currVal) => ((prevHash << 5) - prevHash + currVal.charCodeAt(0)) | 0, 0);
};
//# sourceMappingURL=utils.js.map