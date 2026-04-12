export function getBlockProps(model) {
    const keys = model.keys;
    const values = keys.map(key => model[key]);
    const blockProps = Object.fromEntries(keys.map((key, i) => [key, values[i]]));
    return blockProps;
}
//# sourceMappingURL=block-props.js.map