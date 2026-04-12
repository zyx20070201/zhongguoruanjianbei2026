type MatchEvent<T extends string> = T extends UIEventStateType ? BlockSuiteUIEventState[T] : UIEventState;
export declare class UIEventState {
    event: Event;
    /** when extends, override it with pattern `xxxState` */
    type: string;
    constructor(event: Event);
}
export declare class UIEventStateContext {
    private _map;
    add: <State extends UIEventState = UIEventState>(state: State) => void;
    get: <Type extends UIEventStateType = keyof BlockSuiteUIEventState>(type: Type) => MatchEvent<Type>;
    has: (type: UIEventStateType) => boolean;
    static from(...states: UIEventState[]): UIEventStateContext;
}
export type UIEventHandler = (context: UIEventStateContext) => boolean | null | undefined | void;
declare global {
    interface BlockSuiteUIEventState {
        defaultState: UIEventState;
    }
    type UIEventStateType = keyof BlockSuiteUIEventState;
}
export {};
//# sourceMappingURL=base.d.ts.map