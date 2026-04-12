import type { Constructor } from '@blocksuite/global/utils';
import type { LitElement, TemplateResult } from 'lit';
import type { PeekableClass, PeekableOptions } from './type.js';
export declare const isPeekable: <Element extends LitElement>(e: Element) => boolean;
export declare const peek: <Element extends LitElement>(e: Element, template?: TemplateResult) => void;
/**
 * Mark a class as peekable, which means the class can be peeked by the peek view service.
 *
 * Note: This class must be syntactically below the `@customElement` decorator (it will be applied before customElement).
 */
export declare const Peekable: <T extends PeekableClass, C extends Constructor<PeekableClass>>(options?: PeekableOptions<T>) => (Class: C, context: ClassDecoratorContext) => C | undefined;
//# sourceMappingURL=peekable.d.ts.map