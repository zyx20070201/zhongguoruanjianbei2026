/**
 * The symbol to mark a model as a container.
 */
export const gfxGroupCompatibleSymbol = Symbol('GfxGroupCompatible');
/**
 * Check if the element is a container element.
 */
export const isGfxGroupCompatibleModel = (elm) => {
    if (typeof elm !== 'object' || elm === null)
        return false;
    return (gfxGroupCompatibleSymbol in elm && elm[gfxGroupCompatibleSymbol] === true);
};
//# sourceMappingURL=base.js.map