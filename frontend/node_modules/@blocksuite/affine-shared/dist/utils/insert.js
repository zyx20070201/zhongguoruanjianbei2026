export function insertPositionToIndex(position, arr, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
key = (value) => value.id) {
    if (typeof position === 'object') {
        const index = arr.findIndex(v => key(v) === position.id);
        return index + (position.before ? 0 : 1);
    }
    if (position == null || position === 'start') {
        return 0;
    }
    if (position === 'end') {
        return arr.length;
    }
    return arr.findIndex(v => key(v) === position) + 1;
}
export const arrayMove = (arr, from, to) => {
    const columnIndex = arr.findIndex(v => from(v));
    if (columnIndex < 0) {
        return arr;
    }
    const newArr = [...arr];
    const [ele] = newArr.splice(columnIndex, 1);
    const index = to(newArr);
    newArr.splice(index, 0, ele);
    return newArr;
};
//# sourceMappingURL=insert.js.map