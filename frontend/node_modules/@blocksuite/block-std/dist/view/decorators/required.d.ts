import type { Constructor } from '@blocksuite/global/utils';
import type { LitElement } from 'lit';
type ValidatorFunction = (value: unknown) => boolean;
export declare const PropTypes: {
    string: (value: unknown) => value is string;
    number: (value: unknown) => value is number;
    boolean: (value: unknown) => value is boolean;
    object: (value: unknown) => value is object | null;
    array: (value: unknown) => value is any[];
    instanceOf: (expectedClass: Constructor) => (value: unknown) => boolean;
    arrayOf: (validator: ValidatorFunction) => (value: unknown) => boolean;
    recordOf: (validator: ValidatorFunction) => (value: unknown) => boolean;
};
export declare function requiredProperties(propTypes: Record<string, ValidatorFunction>): (constructor: Constructor<LitElement>) => void;
export {};
//# sourceMappingURL=required.d.ts.map