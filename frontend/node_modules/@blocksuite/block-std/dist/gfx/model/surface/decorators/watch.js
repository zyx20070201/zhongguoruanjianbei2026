import { getObjectPropMeta, setObjectPropMeta } from './common.js';
const watchSymbol = Symbol('watch');
/**
 * The watch decorator is used to watch the property change of the element.
 * You can thinks of it as a decorator version of `elementUpdated` slot of the surface model.
 */
export function watch(fn) {
    return function watchDecorator(_, context) {
        const prop = context.name;
        return {
            init(v) {
                setObjectPropMeta(watchSymbol, Object.getPrototypeOf(this), prop, fn);
                return v;
            },
        };
    };
}
function getWatchMeta(proto, prop) {
    return getObjectPropMeta(proto, watchSymbol, prop);
}
function startWatch(prop, receiver) {
    const proto = Object.getPrototypeOf(receiver);
    const watchFn = getWatchMeta(proto, prop);
    if (!watchFn)
        return;
    receiver['_disposable'].add(receiver.surface.elementUpdated.on(payload => {
        if (payload.id === receiver.id && prop in payload.props) {
            watchFn(payload.oldValues[prop], receiver, payload.local);
        }
    }));
}
export function initializeWatchers(prototype, receiver) {
    const watchers = getObjectPropMeta(prototype, watchSymbol);
    Object.keys(watchers).forEach(prop => {
        startWatch(prop, receiver);
    });
}
//# sourceMappingURL=watch.js.map