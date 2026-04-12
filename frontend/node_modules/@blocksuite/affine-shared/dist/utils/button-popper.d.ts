import type { Disposable } from '@blocksuite/global/utils';
import { type Rect } from '@floating-ui/dom';
export declare function listenClickAway(element: HTMLElement, onClickAway: () => void): Disposable;
type Display = 'show' | 'hidden';
/**
 * Using attribute 'data-show' to control popper visibility.
 *
 * ```css
 * selector {
 *   display: none;
 * }
 * selector[data-show] {
 *   display: block;
 * }
 * ```
 */
export declare function createButtonPopper(reference: HTMLElement, popperElement: HTMLElement, stateUpdated?: (state: {
    display: Display;
}) => void, { mainAxis, crossAxis, rootBoundary, ignoreShift, }?: {
    mainAxis?: number;
    crossAxis?: number;
    rootBoundary?: Rect | (() => Rect | undefined);
    ignoreShift?: boolean;
}): {
    readonly state: Display;
    show: (force?: boolean) => void;
    hide: () => void;
    toggle: () => void;
    dispose: () => void;
};
export {};
//# sourceMappingURL=button-popper.d.ts.map