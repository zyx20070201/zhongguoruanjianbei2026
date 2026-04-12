import { viewType } from '../../core/view/data-view.js';
import { TableSingleView } from './table-view-manager.js';
export const tableViewType = viewType('table');
export const tableViewModel = tableViewType.createModel({
    defaultName: 'Table View',
    dataViewManager: TableSingleView,
    defaultData: viewManager => {
        return {
            mode: 'table',
            columns: [],
            filter: {
                type: 'group',
                op: 'and',
                conditions: [],
            },
            header: {
                titleColumn: viewManager.dataSource.properties$.value.find(id => viewManager.dataSource.propertyTypeGet(id) === 'title'),
                iconColumn: 'type',
            },
        };
    },
});
//# sourceMappingURL=define.js.map