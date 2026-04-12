import type { GfxPrimitiveElementModel } from '../element-model.js';
type WatchFn<T extends GfxPrimitiveElementModel = GfxPrimitiveElementModel> = (oldValue: unknown, instance: T, local: boolean) => void;
/**
 * The watch decorator is used to watch the property change of the element.
 * You can thinks of it as a decorator version of `elementUpdated` slot of the surface model.
 */
export declare function watch<V, T extends GfxPrimitiveElementModel>(fn: WatchFn<T>): (_: unknown, context: ClassAccessorDecoratorContext) => ClassAccessorDecoratorResult<GfxPrimitiveElementModel, V>;
export declare function initializeWatchers(prototype: unknown, receiver: GfxPrimitiveElementModel): void;
export {};
//# sourceMappingURL=watch.d.ts.map