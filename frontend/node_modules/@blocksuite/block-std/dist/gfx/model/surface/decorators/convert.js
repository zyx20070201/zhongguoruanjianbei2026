import { getObjectPropMeta, setObjectPropMeta } from './common.js';
const convertSymbol = Symbol('convert');
/**
 * The convert decorator is used to convert the property value before it's
 * set to the Y map.
 *
 * Note:
 * 1. This decorator function will not execute in model initialization.
 * @param fn
 * @returns
 */
export function convert(fn) {
    return function convertDecorator(_, context) {
        const prop = String(context.name);
        return {
            init(v) {
                const proto = Object.getPrototypeOf(this);
                setObjectPropMeta(convertSymbol, proto, prop, fn);
                return v;
            },
        };
    };
}
function getConvertMeta(proto, prop) {
    return getObjectPropMeta(proto, convertSymbol, prop);
}
export function convertProps(propName, propValue, receiver) {
    const proto = Object.getPrototypeOf(receiver);
    const convertFn = getConvertMeta(proto, propName);
    return convertFn ? convertFn(propValue, receiver) : propValue;
}
//# sourceMappingURL=convert.js.map