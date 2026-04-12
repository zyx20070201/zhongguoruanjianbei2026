export function toDraftModel(origin) {
    const { id, version, flavour, role, keys, text, children } = origin;
    const props = origin.keys.reduce((acc, key) => {
        return {
            ...acc,
            [key]: origin[key],
        };
    }, {});
    return {
        id,
        version,
        flavour,
        role,
        keys,
        text,
        children: children.map(toDraftModel),
        ...props,
    };
}
//# sourceMappingURL=draft.js.map