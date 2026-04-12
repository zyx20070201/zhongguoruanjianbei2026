export class SpecBuilder {
    get value() {
        return this._value;
    }
    constructor(spec) {
        this._value = [...spec];
    }
    extend(extensions) {
        this._value = [...this._value, ...extensions];
    }
}
//# sourceMappingURL=spec-builder.js.map