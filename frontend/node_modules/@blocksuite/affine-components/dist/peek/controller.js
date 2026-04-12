import { PeekViewProvider } from './service.js';
export class PeekableController {
    get peekable() {
        return (!!this._getPeekViewService() &&
            (this.enable ? this.enable(this.target) : true));
    }
    constructor(target, enable) {
        this.target = target;
        this.enable = enable;
        this._getPeekViewService = () => {
            return this.target.std.getOptional(PeekViewProvider);
        };
        this.peek = (template) => {
            return Promise.resolve(this._getPeekViewService()?.peek({
                target: this.target,
                template,
            }));
        };
    }
}
//# sourceMappingURL=controller.js.map