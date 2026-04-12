import type { CSSResult } from 'lit';
import { type Placement } from '@floating-ui/dom';
import { LitElement } from 'lit';
import { type HoverOptions } from '../hover/index.js';
/**
 * @example
 * ```ts
 * // Simple usage
 * html`
 * <affine-tooltip>Content</affine-tooltip>
 * `
 * // With placement
 * html`
 * <affine-tooltip tip-position="top">
 *   Content
 * </affine-tooltip>
 * `
 *
 * // With custom properties
 * html`
 * <affine-tooltip
 *   .zIndex=${0}
 *   .offset=${4}
 *   .autoFlip=${true}
 *   .arrow=${true}
 *   .tooltipStyle=${css`:host { z-index: 0; --affine-tooltip: #fff; }`}
 *   .allowInteractive=${false}
 * >
 *   Content
 * </affine-tooltip>
 * `
 * ```
 */
export declare class Tooltip extends LitElement {
    static styles: CSSResult;
    private _hoverController;
    private _setUpHoverController;
    private _getStyles;
    connectedCallback(): void;
    getPortal(): HTMLDivElement | undefined;
    /**
     * Allow the tooltip to be interactive.
     * eg. allow the user to select text in the tooltip.
     */
    accessor allowInteractive: boolean;
    /**
     * Show a triangle arrow pointing to the reference element.
     */
    accessor arrow: boolean;
    /**
     * changes the placement of the floating element in order to keep it in view,
     * with the ability to flip to any placement.
     *
     * See https://floating-ui.com/docs/flip
     */
    accessor autoFlip: boolean;
    accessor hoverOptions: Partial<HoverOptions>;
    /**
     * Default is `4px`
     *
     * See https://floating-ui.com/docs/offset
     */
    accessor offset: number;
    accessor placement: Placement;
    accessor tooltipStyle: CSSResult;
    accessor zIndex: number | string;
}
declare global {
    interface HTMLElementTagNameMap {
        'affine-tooltip': Tooltip;
    }
}
//# sourceMappingURL=tooltip.d.ts.map