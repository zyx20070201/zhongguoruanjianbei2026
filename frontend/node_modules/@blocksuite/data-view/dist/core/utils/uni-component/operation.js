export const uniMap = (component, map) => {
    return (ele, props) => {
        const result = component(ele, map(props));
        return {
            unmount: result.unmount,
            update: props => {
                result.update(map(props));
            },
            expose: result.expose,
        };
    };
};
//# sourceMappingURL=operation.js.map