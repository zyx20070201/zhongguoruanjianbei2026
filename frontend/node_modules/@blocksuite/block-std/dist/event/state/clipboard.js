import { UIEventState } from '../base.js';
export class ClipboardEventState extends UIEventState {
    constructor({ event }) {
        super(event);
        this.type = 'clipboardState';
        this.raw = event;
    }
}
//# sourceMappingURL=clipboard.js.map