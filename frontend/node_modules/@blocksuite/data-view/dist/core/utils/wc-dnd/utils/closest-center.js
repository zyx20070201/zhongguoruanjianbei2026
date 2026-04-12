import { distanceBetween } from './distance-between-points.js';
/**
 * Returns the coordinates of the center of a given ClientRect
 */
const centerOfRectangle = (rect, left = rect.left, top = rect.top) => ({
    x: left + rect.width * 0.5,
    y: top + rect.height * 0.5,
});
/**
 * Returns the closest rectangles from an array of rectangles to the center of a given
 * rectangle.
 */
export const closestCenter = ({ collisionRect, droppableRects, droppableContainers, }) => {
    let closest;
    const centerRect = centerOfRectangle(collisionRect);
    for (const droppableContainer of droppableContainers) {
        const { id } = droppableContainer;
        const rect = droppableRects.get(id);
        if (rect) {
            const distBetween = distanceBetween(centerOfRectangle(rect), centerRect);
            if (!closest || distBetween < closest.value) {
                closest = { id, value: distBetween };
            }
        }
    }
    return closest ? [closest] : [];
};
//# sourceMappingURL=closest-center.js.map