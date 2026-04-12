import { on, once } from '@blocksuite/blocks';
/**
 * start drag notes
 * @param notes notes to drag
 */
export function startDragging(options) {
    const { document, host, container, onDragMove, onDragEnd, outlineListContainer, } = options;
    const maskElement = createMaskElement(document);
    const listContainerRect = outlineListContainer.getBoundingClientRect();
    const children = Array.from(outlineListContainer.children);
    let idx;
    let indicatorTranslateY;
    container.renderRoot.append(maskElement);
    const insideListContainer = (e) => {
        return (e.clientX >= listContainerRect.left &&
            e.clientX <= listContainerRect.right &&
            e.clientY >= listContainerRect.top &&
            e.clientY <= listContainerRect.bottom);
    };
    const disposeMove = on(container, 'mousemove', e => {
        if (!insideListContainer(e)) {
            idx = undefined;
            onDragMove?.(idx, 0);
            return;
        }
        idx = 0;
        for (const note of children) {
            if (note.invisible || !note.note)
                break;
            const topBoundary = listContainerRect.top + note.offsetTop - outlineListContainer.scrollTop;
            const midBoundary = topBoundary + note.offsetHeight / 2;
            const bottomBoundary = topBoundary + note.offsetHeight;
            if (e.clientY >= topBoundary && e.clientY <= bottomBoundary) {
                idx = e.clientY > midBoundary ? idx + 1 : idx;
                indicatorTranslateY =
                    e.clientY > midBoundary ? bottomBoundary : topBoundary;
                indicatorTranslateY -= listContainerRect.top;
                onDragMove?.(idx, indicatorTranslateY);
                return;
            }
            ++idx;
        }
        onDragMove?.(idx);
    });
    let ended = false;
    const dragEnd = () => {
        if (ended)
            return;
        ended = true;
        maskElement.remove();
        disposeMove();
        onDragEnd?.(idx);
    };
    once(host, 'mouseup', dragEnd);
}
function createMaskElement(doc) {
    const mask = doc.createElement('div');
    mask.style.height = '100vh';
    mask.style.width = '100vw';
    mask.style.position = 'fixed';
    mask.style.left = '0';
    mask.style.top = '0';
    mask.style.zIndex = 'calc(var(--affine-z-index-popover, 0) + 3)';
    mask.style.cursor = 'grabbing';
    return mask;
}
//# sourceMappingURL=drag.js.map