import { type ReadonlySignal } from '@preact/signals-core';
export declare const autoScrollOnBoundary: (container: HTMLElement, box: ReadonlySignal<{
    left: number;
    right: number;
    top: number;
    bottom: number;
}>, ops?: {
    onScroll?: () => void;
}) => () => void;
//# sourceMappingURL=auto-scroll.d.ts.map