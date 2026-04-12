import { Array as YArray, Map as YMap } from 'yjs';
import type { UnRecord } from './utils.js';
import { BaseReactiveYData } from './utils.js';
export type ProxyOptions<T> = {
    onChange?: (data: T) => void;
};
export declare class ReactiveYArray extends BaseReactiveYData<unknown[], YArray<unknown>> {
    protected readonly _source: unknown[];
    protected readonly _ySource: YArray<unknown>;
    protected readonly _options: ProxyOptions<unknown[]>;
    private _observer;
    protected _getProxy: () => unknown[];
    protected readonly _proxy: unknown[];
    constructor(_source: unknown[], _ySource: YArray<unknown>, _options: ProxyOptions<unknown[]>);
    pop(prop: number): void;
    stash(prop: number): void;
}
export declare class ReactiveYMap extends BaseReactiveYData<UnRecord, YMap<unknown>> {
    protected readonly _source: UnRecord;
    protected readonly _ySource: YMap<unknown>;
    protected readonly _options: ProxyOptions<UnRecord>;
    private _observer;
    protected _getProxy: () => UnRecord;
    protected readonly _proxy: UnRecord;
    constructor(_source: UnRecord, _ySource: YMap<unknown>, _options: ProxyOptions<UnRecord>);
    pop(prop: string): void;
    stash(prop: string): void;
}
export declare function createYProxy<Data>(yAbstract: unknown, options?: ProxyOptions<Data>): Data;
export declare function stashProp(yMap: YMap<unknown>, prop: string): void;
export declare function stashProp(yMap: YArray<unknown>, prop: number): void;
export declare function popProp(yMap: YMap<unknown>, prop: string): void;
export declare function popProp(yMap: YArray<unknown>, prop: number): void;
//# sourceMappingURL=proxy.d.ts.map