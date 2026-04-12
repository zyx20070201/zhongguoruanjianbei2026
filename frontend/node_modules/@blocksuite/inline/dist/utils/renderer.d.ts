import { type TemplateResult } from 'lit';
import type { DeltaInsert } from '../types.js';
import type { BaseTextAttributes } from './base-attributes.js';
export declare function renderElement<TextAttributes extends BaseTextAttributes>(delta: DeltaInsert<TextAttributes>, parseAttributes: (textAttributes?: TextAttributes) => TextAttributes | undefined, selected: boolean): TemplateResult<1>;
//# sourceMappingURL=renderer.d.ts.map