import Zod from 'zod';
import type { AnyTypeInstance, TypeInstance, Unify, ValueTypeOf } from './type.js';
import type { TypeVarContext, TypeVarDefinitionInstance } from './type-variable.js';
type FnValueType<Args extends readonly TypeInstance[], Return extends TypeInstance> = (...args: {
    [K in keyof Args]: ValueTypeOf<Args[K]>;
}) => ValueTypeOf<Return>;
export declare class FnTypeInstance<Args extends readonly TypeInstance[] = readonly TypeInstance[], Return extends TypeInstance = TypeInstance> implements TypeInstance {
    readonly args: Args;
    readonly rt: Return;
    readonly vars: TypeVarDefinitionInstance[];
    _validate: Zod.ZodFunction<Zod.ZodTuple<[], Zod.ZodUnknown>, Zod.ZodUnknown>;
    readonly _valueType: FnValueType<Args, Return>;
    name: string;
    constructor(args: Args, rt: Return, vars: TypeVarDefinitionInstance[]);
    subst(ctx: TypeVarContext): FnTypeInstance<TypeInstance[], TypeInstance> | undefined;
    unify(ctx: TypeVarContext, template: FnTypeInstance, unify: Unify): boolean;
    valueValidate(value: unknown): value is FnValueType<Args, Return>;
}
export declare class ArrayTypeInstance<Element extends TypeInstance = TypeInstance> implements TypeInstance {
    readonly element: Element;
    readonly _validate: Zod.ZodArray<Zod.ZodType<any, Zod.ZodTypeDef, any>, "many">;
    readonly _valueType: ValueTypeOf<Element>[];
    readonly name = "array";
    constructor(element: Element);
    subst(ctx: TypeVarContext): ArrayTypeInstance<TypeInstance> | undefined;
    unify(ctx: TypeVarContext, type: ArrayTypeInstance, unify: Unify): boolean;
    valueValidate(value: unknown): value is ValueTypeOf<Element>[];
}
export declare const ct: {
    fn: {
        is: (type: AnyTypeInstance) => type is FnTypeInstance;
        instance: <Args extends readonly TypeInstance[], Return extends TypeInstance>(args: Args, rt: Return, vars?: TypeVarDefinitionInstance[]) => FnTypeInstance<Args, Return>;
    };
    array: {
        is: (type: AnyTypeInstance) => type is ArrayTypeInstance;
        instance: <Element extends TypeInstance>(element: Element) => ArrayTypeInstance<Element>;
    };
};
export {};
//# sourceMappingURL=composite-type.d.ts.map