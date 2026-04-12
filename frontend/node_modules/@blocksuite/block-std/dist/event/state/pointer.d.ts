import { UIEventState } from '../base.js';
type PointerEventStateOptions = {
    event: PointerEvent;
    rect: DOMRect;
    startX: number;
    startY: number;
    last: PointerEventState | null;
};
type Point = {
    x: number;
    y: number;
};
export declare class PointerEventState extends UIEventState {
    button: number;
    containerOffset: Point;
    delta: Point;
    keys: {
        shift: boolean;
        cmd: boolean;
        alt: boolean;
    };
    point: Point;
    pressure: number;
    raw: PointerEvent;
    start: Point;
    type: string;
    get x(): number;
    get y(): number;
    constructor({ event, rect, startX, startY, last }: PointerEventStateOptions);
}
export declare class MultiPointerEventState extends UIEventState {
    pointers: PointerEventState[];
    type: string;
    constructor(event: PointerEvent, pointers: PointerEventState[]);
}
declare global {
    interface BlockSuiteUIEventState {
        pointerState: PointerEventState;
        multiPointerState: MultiPointerEventState;
    }
}
export {};
//# sourceMappingURL=pointer.d.ts.map