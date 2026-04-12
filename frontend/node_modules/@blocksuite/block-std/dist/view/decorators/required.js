import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
export const PropTypes = {
    string: (value) => typeof value === 'string',
    number: (value) => typeof value === 'number',
    boolean: (value) => typeof value === 'boolean',
    object: (value) => typeof value === 'object',
    array: (value) => Array.isArray(value),
    instanceOf: (expectedClass) => (value) => value instanceof expectedClass,
    arrayOf: (validator) => (value) => Array.isArray(value) && value.every(validator),
    recordOf: (validator) => (value) => {
        if (typeof value !== 'object' || value === null)
            return false;
        return Object.values(value).every(validator);
    },
};
function validatePropTypes(instance, propTypes) {
    for (const [propName, validator] of Object.entries(propTypes)) {
        const key = propName;
        if (instance[key] === undefined) {
            throw new BlockSuiteError(ErrorCode.DefaultRuntimeError, `Property ${propName} is required to ${instance.constructor.name}.`);
        }
        if (validator && !validator(instance[key])) {
            throw new BlockSuiteError(ErrorCode.DefaultRuntimeError, `Property ${propName} is invalid to ${instance.constructor.name}.`);
        }
    }
}
export function requiredProperties(propTypes) {
    return function (constructor) {
        const connectedCallback = constructor.prototype.connectedCallback;
        constructor.prototype.connectedCallback = function () {
            if (connectedCallback) {
                connectedCallback.call(this);
            }
            validatePropTypes(this, propTypes);
        };
    };
}
//# sourceMappingURL=required.js.map