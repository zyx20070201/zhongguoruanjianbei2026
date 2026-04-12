import { UIEventState } from '../base.js';
export class DndEventState extends UIEventState {
    constructor({ event }) {
        super(event);
        this.type = 'dndState';
        this.raw = event;
    }
}
//# sourceMappingURL=dnd.js.map