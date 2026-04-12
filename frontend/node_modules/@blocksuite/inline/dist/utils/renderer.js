import { html } from 'lit';
export function renderElement(delta, parseAttributes, selected) {
    return html `<v-element
    .selected=${selected}
    .delta=${{
        insert: delta.insert,
        attributes: parseAttributes(delta.attributes),
    }}
  ></v-element>`;
}
//# sourceMappingURL=renderer.js.map