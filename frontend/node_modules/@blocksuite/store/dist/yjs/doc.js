import * as Y from 'yjs';
import { createYProxy } from '../reactive/proxy.js';
export class BlockSuiteDoc extends Y.Doc {
    constructor() {
        super(...arguments);
        this._spaces = this.getMap('spaces');
    }
    get spaces() {
        return this._spaces;
    }
    getArrayProxy(key) {
        const array = super.getArray(key);
        return createYProxy(array);
    }
    getMapProxy(key) {
        const map = super.getMap(key);
        return createYProxy(map);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toJSON() {
        const json = super.toJSON();
        delete json.spaces;
        const spaces = {};
        this.spaces.forEach((doc, key) => {
            spaces[key] = doc.toJSON();
        });
        return {
            ...json,
            spaces,
        };
    }
    transact(f, origin) {
        return super.transact(f, origin);
    }
}
//# sourceMappingURL=doc.js.map