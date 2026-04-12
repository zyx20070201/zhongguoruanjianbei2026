import { nothing } from 'lit';
import { WidgetBase } from '../../../../core/widget/widget-base.js';
export declare class DataViewHeaderToolsFilter extends WidgetBase {
    static styles: import("lit").CSSResult;
    hasFilter: import("@preact/signals-core").ReadonlySignal<boolean>;
    private get _filter();
    private set _filter(value);
    get filterTrait(): import("../../../../core/filter/trait.js").FilterTrait | undefined;
    private get readonly();
    private clickFilter;
    connectedCallback(): void;
    render(): import("lit-html").TemplateResult<1> | typeof nothing;
    toggleShowFilter(show?: boolean): void;
}
declare global {
    interface HTMLElementTagNameMap {
        'data-view-header-tools-filter': DataViewHeaderToolsFilter;
    }
}
//# sourceMappingURL=filter.d.ts.map