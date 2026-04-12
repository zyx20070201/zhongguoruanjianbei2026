import type { GfxPrimitiveElementModel } from '../element-model.js';
/**
 * A decorator to mark the property as a local property.
 *
 * The local property act like it is a field property, but it's not synced to the Y map.
 * Updating local property will also trigger the `elementUpdated` slot of the surface model
 */
export declare function local<V, T extends GfxPrimitiveElementModel>(): (_target: ClassAccessorDecoratorTarget<T, V>, context: ClassAccessorDecoratorContext) => ClassAccessorDecoratorResult<T, V>;
//# sourceMappingURL=local.d.ts.map