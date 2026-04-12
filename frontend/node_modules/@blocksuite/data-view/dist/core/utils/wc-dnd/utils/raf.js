let rafId = null;
let rafCallback = null;
export function raf(callback) {
    if (!callback) {
        rafCallback = null;
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        return;
    }
    const lastTime = performance.now();
    rafCallback = () => {
        rafId = null;
        callback(performance.now() - lastTime);
    };
    if (rafId === null) {
        rafId = requestAnimationFrame(time => {
            rafCallback?.(time);
        });
    }
}
//# sourceMappingURL=raf.js.map