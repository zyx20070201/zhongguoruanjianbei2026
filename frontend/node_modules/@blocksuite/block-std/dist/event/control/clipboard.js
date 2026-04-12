import { UIEventState, UIEventStateContext } from '../base.js';
import { ClipboardEventState } from '../state/clipboard.js';
import { EventScopeSourceType, EventSourceState } from '../state/source.js';
export class ClipboardControl {
    constructor(_dispatcher) {
        this._dispatcher = _dispatcher;
        this._copy = (event) => {
            const clipboardEventState = new ClipboardEventState({
                event,
            });
            this._dispatcher.run('copy', this._createContext(event, clipboardEventState));
        };
        this._cut = (event) => {
            const clipboardEventState = new ClipboardEventState({
                event,
            });
            this._dispatcher.run('cut', this._createContext(event, clipboardEventState));
        };
        this._paste = (event) => {
            const clipboardEventState = new ClipboardEventState({
                event,
            });
            this._dispatcher.run('paste', this._createContext(event, clipboardEventState));
        };
    }
    _createContext(event, clipboardState) {
        return UIEventStateContext.from(new UIEventState(event), new EventSourceState({
            event,
            sourceType: EventScopeSourceType.Selection,
        }), clipboardState);
    }
    listen() {
        this._dispatcher.disposables.addFromEvent(document, 'cut', this._cut);
        this._dispatcher.disposables.addFromEvent(document, 'copy', this._copy);
        this._dispatcher.disposables.addFromEvent(document, 'paste', this._paste);
    }
}
//# sourceMappingURL=clipboard.js.map