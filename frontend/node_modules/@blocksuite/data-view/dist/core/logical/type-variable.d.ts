import Zod from 'zod';
import type { TypeInstance, Unify } from './type.js';
export declare class TypeVarDefinitionInstance<Name extends string = string, Type extends TypeInstance = TypeInstance> {
    readonly varName: Name;
    readonly typeConstraint?: Type | undefined;
    readonly name = "__TypeVarDefine";
    constructor(varName: Name, typeConstraint?: Type | undefined);
}
export declare class TypeVarReferenceInstance<Name extends string = string> implements TypeInstance {
    readonly varName: Name;
    readonly _validate: Zod.ZodUnknown;
    readonly _valueType: unknown;
    readonly name = "__TypeVarReference";
    constructor(varName: Name);
    subst(ctx: TypeVarContext): void | TypeInstance;
    unify(_ctx: TypeVarContext, _type: TypeInstance, _unify: Unify): boolean;
    valueValidate(_value: unknown): _value is unknown;
}
export declare const tv: {
    typeVarDefine: {
        create: <Name extends string = string, Type extends TypeInstance = TypeInstance>(name: Name, typeConstraint?: Type) => TypeVarDefinitionInstance<Name, Type>;
    };
    typeVarReference: {
        create: <Name extends string>(name: Name) => TypeVarReferenceInstance<Name>;
        is: (type: TypeInstance) => type is TypeVarReferenceInstance;
    };
};
export type TypeVarDefine = {
    define: TypeVarDefinitionInstance;
    type?: TypeInstance;
};
export type TypeVarContext = Record<string, TypeVarDefine>;
export declare const tRef: <Name extends string>(name: Name) => TypeVarReferenceInstance<Name>;
export declare const tVar: <Name extends string = string, Type extends TypeInstance = TypeInstance>(name: Name, typeConstraint?: Type) => TypeVarDefinitionInstance<Name, Type>;
//# sourceMappingURL=type-variable.d.ts.map