export class DTInstance {
    constructor(name, _validate, data) {
        this.name = name;
        this._validate = _validate;
        this.data = data;
        this._valueType = undefined;
    }
    subst(_ctx) {
        return this;
    }
    unify(_ctx, type, _unify) {
        if (this.name !== type.name) {
            return false;
        }
        if (type.data == null) {
            return true;
        }
        return this.data != null;
    }
    valueValidate(value) {
        return this._validate.safeParse(value).success;
    }
}
export class DataType {
    constructor(name, _dataSchema, valueSchema) {
        this.name = name;
        this.valueSchema = valueSchema;
    }
    instance(literal) {
        return new DTInstance(this.name, this.valueSchema, literal);
    }
    is(type) {
        return type.name === this.name;
    }
}
export const defineDataType = (name, validateData, validateValue) => {
    return new DataType(name, validateData, validateValue);
};
//# sourceMappingURL=data-type.js.map