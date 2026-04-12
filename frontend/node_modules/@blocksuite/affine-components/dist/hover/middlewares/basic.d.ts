import type { HoverMiddleware } from '../types.js';
/**
 * When the mouse is hovering in, the `mouseover` event will be fired multiple times.
 * This middleware will filter out the duplicated events.
 */
export declare const dedupe: (keepWhenFloatingNotReady?: boolean) => HoverMiddleware;
/**
 * Wait some time before emitting the `mouseover` event.
 */
export declare const delayShow: (delay: number) => HoverMiddleware;
/**
 * Wait some time before emitting the `mouseleave` event.
 */
export declare const delayHide: (delay: number) => HoverMiddleware;
//# sourceMappingURL=basic.d.ts.map