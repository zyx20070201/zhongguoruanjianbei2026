import { UndoManager, Array as YArray, Map as YMap, Text as YText } from 'yjs';
import { Boxed } from './boxed.js';
import { Text } from './text.js';
export function isPureObject(value) {
    return (value !== null &&
        typeof value === 'object' &&
        Object.prototype.toString.call(value) === '[object Object]' &&
        [Object, undefined, null].some(x => x === value.constructor));
}
export function native2Y(value, { deep = true, transform = x => x } = {}) {
    if (value instanceof Boxed) {
        return value.yMap;
    }
    if (value instanceof Text) {
        if (value.yText.doc) {
            return value.yText.clone();
        }
        return value.yText;
    }
    if (Array.isArray(value)) {
        const yArray = new YArray();
        const result = value.map(item => {
            return deep ? native2Y(item, { deep, transform }) : item;
        });
        yArray.insert(0, result);
        return yArray;
    }
    if (isPureObject(value)) {
        const yMap = new YMap();
        Object.entries(value).forEach(([key, value]) => {
            yMap.set(key, deep ? native2Y(value, { deep, transform }) : value);
        });
        return yMap;
    }
    return value;
}
export function y2Native(yAbstract, { deep = true, transform = x => x } = {}) {
    if (Boxed.is(yAbstract)) {
        const data = new Boxed(yAbstract);
        return transform(data, yAbstract);
    }
    if (yAbstract instanceof YText) {
        const data = new Text(yAbstract);
        return transform(data, yAbstract);
    }
    if (yAbstract instanceof YArray) {
        const data = yAbstract
            .toArray()
            .map(item => (deep ? y2Native(item, { deep, transform }) : item));
        return transform(data, yAbstract);
    }
    if (yAbstract instanceof YMap) {
        const data = Object.fromEntries(Array.from(yAbstract.entries()).map(([key, value]) => {
            return [key, deep ? y2Native(value, { deep, transform }) : value];
        }));
        return transform(data, yAbstract);
    }
    return transform(yAbstract, yAbstract);
}
export class BaseReactiveYData {
    constructor() {
        this._getOrigin = (doc) => {
            return {
                doc,
                proxy: true,
                target: this,
            };
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this._onObserve = (event, handler) => {
            if (event.transaction.origin?.proxy !== true &&
                (!event.transaction.local ||
                    event.transaction.origin instanceof UndoManager)) {
                handler();
            }
            this._options.onChange?.(this._proxy);
        };
        this._skipNext = false;
        this._stashed = new Set();
        this._transact = (doc, fn) => {
            doc.transact(fn, this._getOrigin(doc));
        };
        this._updateWithSkip = (fn) => {
            this._skipNext = true;
            fn();
            this._skipNext = false;
        };
    }
    get proxy() {
        return this._proxy;
    }
}
//# sourceMappingURL=utils.js.map