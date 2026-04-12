export function brush(model, ctx, matrix, renderer) {
    const { rotate } = model;
    const [, , w, h] = model.deserializedXYWH;
    const cx = w / 2;
    const cy = h / 2;
    ctx.setTransform(matrix.translateSelf(cx, cy).rotateSelf(rotate).translateSelf(-cx, -cy));
    const color = renderer.getColorValue(model.color, '#000000', true);
    ctx.fillStyle = color;
    ctx.fill(new Path2D(model.commands));
}
//# sourceMappingURL=index.js.map