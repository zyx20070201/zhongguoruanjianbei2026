import { computed } from '@preact/signals-core';
import { arrayMove } from '../utils/wc-dnd/utils/array-move.js';
export const createSortUtils = (sortTrait, eventTrace) => {
    const view = sortTrait.view;
    const varsMap$ = computed(() => {
        return new Map(view.vars$.value.map(v => [v.id, v]));
    });
    const sortList$ = sortTrait.sortList$;
    const sortParams = (sort, index) => {
        if (!sort) {
            return;
        }
        const v = varsMap$.value.get(sort.ref.name);
        return {
            fieldId: sort.ref.name,
            fieldType: v?.propertyType ?? '',
            orderType: sort.desc ? 'desc' : 'asc',
            orderIndex: index ?? sortList$.value.findIndex(v => v.ref.name === sort.ref.name),
        };
    };
    return {
        vars$: view.vars$,
        sortList$: sortList$,
        add: sort => {
            const list = sortTrait.sortList$.value;
            sortTrait.setSortList([...list, sort]);
            const params = sortParams(sort, list.length);
            if (params) {
                eventTrace('DatabaseSortAdd', params);
            }
        },
        move: (fromIndex, toIndex) => {
            const list = sortTrait.sortList$.value;
            const from = sortParams(list[fromIndex], fromIndex);
            const newList = arrayMove(list, fromIndex, toIndex);
            sortTrait.setSortList(newList);
            const prev = sortParams(newList[toIndex - 1], toIndex - 1);
            const next = sortParams(newList[toIndex + 1], toIndex + 1);
            if (from) {
                eventTrace('DatabaseSortReorder', {
                    ...from,
                    prevFieldType: prev?.fieldType ?? '',
                    nextFieldType: next?.fieldType ?? '',
                    newOrderIndex: toIndex,
                });
            }
        },
        change: (index, sort) => {
            const list = sortTrait.sortList$.value.slice();
            const old = sortParams(list[index], index);
            list[index] = sort;
            sortTrait.setSortList(list);
            const params = sortParams(sort, index);
            if (params && old) {
                eventTrace('DatabaseSortModify', {
                    ...params,
                    oldOrderType: old.orderType,
                    oldFieldType: old.fieldType,
                    oldFieldId: old.fieldId,
                });
            }
        },
        remove: index => {
            const list = sortTrait.sortList$.value.slice();
            const old = sortParams(list[index], index);
            list.splice(index, 1);
            sortTrait.setSortList([...list]);
            if (old) {
                eventTrace('DatabaseSortRemove', old);
            }
        },
        removeAll: () => {
            const count = sortTrait.sortList$.value.length;
            sortTrait.setSortList([]);
            eventTrace('DatabaseSortClear', {
                rulesCount: count,
            });
        },
    };
};
//# sourceMappingURL=utils.js.map