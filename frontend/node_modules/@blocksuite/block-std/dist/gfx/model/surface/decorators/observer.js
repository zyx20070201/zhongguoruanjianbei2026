import { getObjectPropMeta, setObjectPropMeta } from './common.js';
const observeSymbol = Symbol('observe');
const observerDisposableSymbol = Symbol('observerDisposable');
/**
 * A decorator to observe the y type property.
 * You can think of it is just a decorator version of 'observe' method of Y.Array and Y.Map.
 *
 * The observer function start to observe the property when the model is mounted. And it will
 * re-observe the property automatically when the value is altered.
 * @param fn
 * @returns
 */
export function observe(fn) {
    return function observeDecorator(_, context) {
        const prop = context.name;
        return {
            init(v) {
                setObjectPropMeta(observeSymbol, Object.getPrototypeOf(this), prop, fn);
                return v;
            },
        };
    };
}
function getObserveMeta(proto, prop) {
    // @ts-ignore
    return getObjectPropMeta(proto, observeSymbol, prop);
}
export function startObserve(prop, receiver) {
    const proto = Object.getPrototypeOf(receiver);
    const observeFn = getObserveMeta(proto, prop);
    // @ts-ignore
    const observerDisposable = receiver[observerDisposableSymbol] ?? {};
    // @ts-ignore
    receiver[observerDisposableSymbol] = observerDisposable;
    if (observerDisposable[prop]) {
        observerDisposable[prop]();
        delete observerDisposable[prop];
    }
    if (!observeFn) {
        return;
    }
    const value = receiver[prop];
    observeFn(null, receiver, null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (event, transaction) => {
        observeFn(event, receiver, transaction);
    };
    if (value && 'observe' in value) {
        value.observe(fn);
        observerDisposable[prop] = () => {
            value.unobserve(fn);
        };
    }
    else {
        console.warn(`Failed to observe "${prop.toString()}" of ${receiver.type} element, make sure it's a Y type.`);
    }
}
export function initializeObservers(proto, receiver) {
    const observers = getObjectPropMeta(proto, observeSymbol);
    Object.keys(observers).forEach(prop => {
        startObserve(prop, receiver);
    });
    receiver['_disposable'].add(() => {
        // @ts-ignore
        Object.values(receiver[observerDisposableSymbol] ?? {}).forEach(dispose => dispose());
    });
}
//# sourceMappingURL=observer.js.map