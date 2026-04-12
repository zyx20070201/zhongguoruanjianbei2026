import { signal } from '@preact/signals-core';
export const startDrag = (evt, ops) => {
    const oldCursor = document.body.style.cursor;
    document.body.style.cursor = ops.cursor ?? 'grab';
    const mousePosition = signal({
        x: evt.clientX,
        y: evt.clientY,
    });
    const transform = ops?.transform ?? (e => e);
    const param = transform(evt);
    const result = {
        data: ops.onDrag(param),
        last: param,
        mousePosition,
        move: (p) => {
            result.data = ops.onMove(p);
        },
    };
    const clear = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('keydown', keydown);
        document.body.style.cursor = oldCursor;
        ops.onClear();
    };
    const keydown = (evt) => {
        if (evt.key === 'Escape') {
            clear();
        }
    };
    const move = (evt) => {
        evt.preventDefault();
        mousePosition.value = {
            x: evt.clientX,
            y: evt.clientY,
        };
        const p = transform(evt);
        result.last = p;
        result.data = ops.onMove(p);
    };
    const up = () => {
        try {
            ops.onDrop(result.data);
        }
        finally {
            clear();
        }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', keydown);
    return result;
};
//# sourceMappingURL=drag.js.map