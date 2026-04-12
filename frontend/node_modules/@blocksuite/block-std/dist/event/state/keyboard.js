import { UIEventState } from '../base.js';
export class KeyboardEventState extends UIEventState {
    constructor({ event, composing }) {
        super(event);
        this.type = 'keyboardState';
        this.raw = event;
        this.composing = composing;
    }
}
//# sourceMappingURL=keyboard.js.map