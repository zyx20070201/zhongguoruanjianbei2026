import type { GfxPrimitiveElementModel } from '../element-model.js';
export declare function getFieldPropsSet(target: unknown): Set<string | symbol>;
export declare function field<V, T extends GfxPrimitiveElementModel>(fallback?: V): (_: ClassAccessorDecoratorTarget<T, V>, context: ClassAccessorDecoratorContext) => ClassAccessorDecoratorResult<T, V>;
//# sourceMappingURL=field.d.ts.map