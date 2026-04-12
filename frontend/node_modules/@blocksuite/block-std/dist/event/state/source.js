import { UIEventState } from '../base.js';
export var EventScopeSourceType;
(function (EventScopeSourceType) {
    // The event scope should be built by selection path
    EventScopeSourceType["Selection"] = "selection";
    // The event scope should be built by event target
    EventScopeSourceType["Target"] = "target";
})(EventScopeSourceType || (EventScopeSourceType = {}));
export class EventSourceState extends UIEventState {
    constructor({ event, sourceType }) {
        super(event);
        this.type = 'sourceState';
        this.sourceType = sourceType;
    }
}
//# sourceMappingURL=source.js.map