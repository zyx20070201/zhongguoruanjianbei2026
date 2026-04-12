var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
/**
 * Renders a template into a portal. Defaults to `document.body`.
 *
 * Note that every time the parent component re-renders, the portal will be re-called.
 *
 * See https://lit.dev/docs/components/rendering/#writing-a-good-render()-method
 *
 * @example
 * ```ts
 * render() {
 *   return html`${showPortal
 *     ? html`<blocksuite-portal .template=${portalTemplate}></blocksuite-portal>`
 *     : null}`;
 * };
 * ```
 */
let Portal = (() => {
    let _classSuper = LitElement;
    let _container_decorators;
    let _container_initializers = [];
    let _container_extraInitializers = [];
    let _shadowDom_decorators;
    let _shadowDom_initializers = [];
    let _shadowDom_extraInitializers = [];
    let _template_decorators;
    let _template_initializers = [];
    let _template_extraInitializers = [];
    return class Portal extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _container_decorators = [property({ attribute: false })];
            _shadowDom_decorators = [property({ attribute: false })];
            _template_decorators = [property({ attribute: false })];
            __esDecorate(this, null, _container_decorators, { kind: "accessor", name: "container", static: false, private: false, access: { has: obj => "container" in obj, get: obj => obj.container, set: (obj, value) => { obj.container = value; } }, metadata: _metadata }, _container_initializers, _container_extraInitializers);
            __esDecorate(this, null, _shadowDom_decorators, { kind: "accessor", name: "shadowDom", static: false, private: false, access: { has: obj => "shadowDom" in obj, get: obj => obj.shadowDom, set: (obj, value) => { obj.shadowDom = value; } }, metadata: _metadata }, _shadowDom_initializers, _shadowDom_extraInitializers);
            __esDecorate(this, null, _template_decorators, { kind: "accessor", name: "template", static: false, private: false, access: { has: obj => "template" in obj, get: obj => obj.template, set: (obj, value) => { obj.template = value; } }, metadata: _metadata }, _template_initializers, _template_extraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        createRenderRoot() {
            const portalRoot = document.createElement('div');
            const renderRoot = this.shadowDom
                ? portalRoot.attachShadow({
                    mode: 'open',
                    ...(typeof this.shadowDom !== 'boolean' ? this.shadowDom : {}),
                })
                : portalRoot;
            portalRoot.classList.add('blocksuite-portal');
            this.container.append(portalRoot);
            this._portalRoot = portalRoot;
            return renderRoot;
        }
        disconnectedCallback() {
            super.disconnectedCallback();
            this._portalRoot?.remove();
        }
        render() {
            return this.template;
        }
        #container_accessor_storage;
        get container() { return this.#container_accessor_storage; }
        set container(value) { this.#container_accessor_storage = value; }
        #shadowDom_accessor_storage;
        get shadowDom() { return this.#shadowDom_accessor_storage; }
        set shadowDom(value) { this.#shadowDom_accessor_storage = value; }
        #template_accessor_storage;
        get template() { return this.#template_accessor_storage; }
        set template(value) { this.#template_accessor_storage = value; }
        constructor() {
            super(...arguments);
            this._portalRoot = null;
            this.#container_accessor_storage = __runInitializers(this, _container_initializers, document.body);
            this.#shadowDom_accessor_storage = (__runInitializers(this, _container_extraInitializers), __runInitializers(this, _shadowDom_initializers, true));
            this.#template_accessor_storage = (__runInitializers(this, _shadowDom_extraInitializers), __runInitializers(this, _template_initializers, html ``));
            __runInitializers(this, _template_extraInitializers);
        }
    };
})();
export { Portal };
//# sourceMappingURL=portal.js.map