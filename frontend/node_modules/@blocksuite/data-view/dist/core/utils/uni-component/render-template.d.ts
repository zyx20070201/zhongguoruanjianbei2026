import type { TemplateResult } from 'lit';
import { ShadowlessElement } from '@blocksuite/block-std';
declare const AnyRender_base: typeof ShadowlessElement;
export declare class AnyRender<T> extends AnyRender_base {
    render(): symbol | TemplateResult;
    accessor props: T;
    accessor renderTemplate: (props: T) => TemplateResult | symbol;
}
export declare const renderTemplate: <T>(renderTemplate: (props: T) => TemplateResult | symbol) => AnyRender<T>;
export {};
//# sourceMappingURL=render-template.d.ts.map