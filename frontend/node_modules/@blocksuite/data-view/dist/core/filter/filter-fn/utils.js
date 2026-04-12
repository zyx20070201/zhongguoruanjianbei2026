export const tagToString = (value, type) => {
    if (!type.data) {
        return;
    }
    const map = new Map(type.data.map(v => [v.id, v.value]));
    return value
        .flatMap(id => {
        if (id) {
            return map.get(id);
        }
        return [];
    })
        .join(', ');
};
//# sourceMappingURL=utils.js.map