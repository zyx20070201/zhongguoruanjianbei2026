import type { Y } from '@blocksuite/store';
import type { GfxPrimitiveElementModel } from '../element-model.js';
type ObserveFn<E extends Y.YEvent<any> = Y.YEvent<any>, T extends GfxPrimitiveElementModel = GfxPrimitiveElementModel> = (
/**
 * The event object of the Y.Map or Y.Array, the `null` value means the observer is initializing.
 */
event: E | null, instance: T, 
/**
 * The transaction object of the Y.Map or Y.Array, the `null` value means the observer is initializing.
 */
transaction: Y.Transaction | null) => void;
/**
 * A decorator to observe the y type property.
 * You can think of it is just a decorator version of 'observe' method of Y.Array and Y.Map.
 *
 * The observer function start to observe the property when the model is mounted. And it will
 * re-observe the property automatically when the value is altered.
 * @param fn
 * @returns
 */
export declare function observe<V, E extends Y.YEvent<any>, T extends GfxPrimitiveElementModel>(fn: ObserveFn<E, T>): (_: unknown, context: ClassAccessorDecoratorContext) => ClassAccessorDecoratorResult<GfxPrimitiveElementModel, V>;
export declare function startObserve(prop: string | symbol, receiver: GfxPrimitiveElementModel): void;
export declare function initializeObservers(proto: unknown, receiver: GfxPrimitiveElementModel): void;
export {};
//# sourceMappingURL=observer.d.ts.map