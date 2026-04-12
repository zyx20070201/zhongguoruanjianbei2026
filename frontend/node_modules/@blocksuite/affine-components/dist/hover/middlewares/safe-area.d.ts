import type { HoverMiddleware } from '../types.js';
export type SafeTriangleOptions = {
    zIndex: number;
    buffer: number;
    /**
     * abort triangle guard if the mouse not move for some time
     */
    idleTimeout: number;
    debug?: boolean;
};
/**
 * Part of the code is ported from https://github.com/floating-ui/floating-ui/blob/master/packages/react/src/safePolygon.ts
 * Licensed under MIT.
 */
export declare const safeTriangle: ({ zIndex, buffer, idleTimeout, debug, }?: Partial<SafeTriangleOptions>) => HoverMiddleware;
export type SafeBridgeOptions = {
    debug: boolean;
    idleTimeout: number;
};
/**
 * Create a virtual rectangular bridge between the reference element and the floating element.
 *
 * Part of the code is ported from https://github.com/floating-ui/floating-ui/blob/master/packages/react/src/safePolygon.ts
 * Licensed under MIT.
 */
export declare const safeBridge: ({ debug, idleTimeout, }?: Partial<SafeBridgeOptions>) => HoverMiddleware;
//# sourceMappingURL=safe-area.d.ts.map