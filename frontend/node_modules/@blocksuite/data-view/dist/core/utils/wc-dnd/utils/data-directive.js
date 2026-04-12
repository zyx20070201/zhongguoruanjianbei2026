import { Directive, directive } from 'lit/directive.js';
export const createDataDirective = (...names) => {
    return directive(class DraggableDirective extends Directive {
        constructor(partInfo) {
            super(partInfo);
        }
        render(..._ids) {
            return;
        }
        update(part, ids) {
            names.forEach((name, index) => {
                part.element.dataset[name.dataset] = ids[index];
            });
            return;
        }
    });
};
//# sourceMappingURL=data-directive.js.map