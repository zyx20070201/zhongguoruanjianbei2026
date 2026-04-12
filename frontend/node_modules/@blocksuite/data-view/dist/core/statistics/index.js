import { anyTypeStatsFunctions } from './any.js';
import { checkboxTypeStatsFunctions } from './checkbox.js';
import { numberStatsFunctions } from './number.js';
export const statsFunctions = [
    ...anyTypeStatsFunctions,
    ...numberStatsFunctions,
    ...checkboxTypeStatsFunctions,
];
//# sourceMappingURL=index.js.map