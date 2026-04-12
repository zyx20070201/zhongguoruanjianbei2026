export const viewType = (type) => ({
    type,
    createModel: (model) => ({
        type,
        model,
        createMeta: renderer => ({
            type,
            model,
            renderer,
        }),
    }),
});
//# sourceMappingURL=data-view.js.map