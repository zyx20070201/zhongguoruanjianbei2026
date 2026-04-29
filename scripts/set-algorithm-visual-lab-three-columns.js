const fs = require('fs');
const path = require('path');

const workbenchesFile = path.resolve(__dirname, '../backend/data/workbenches.json');
const targetWorkbenchTitle = 'Algorithm Visual Lab';

const raw = fs.readFileSync(workbenchesFile, 'utf8');
const store = JSON.parse(raw);

store.workbenches = store.workbenches.map((workbench) => {
  if (workbench.title !== targetWorkbenchTitle || !Array.isArray(workbench.state?.editors)) {
    return workbench;
  }

  const editors = workbench.state.editors;
  const byPath = (resourcePath) =>
    editors.find((editor) => editor.resourcePath === resourcePath)?.id || null;
  const byType = (type) => editors.find((editor) => editor.type === type)?.id || null;

  const graphId = byPath('/Algorithm Visual Lab/graph-search-visualizer.html');
  const outlineId = byPath('/Algorithm Visual Lab/algorithm-review-outline.md');
  const guideId = byPath('/Algorithm Visual Lab/visual-study-guide.md');
  const aiId = byType('ai');

  const assigned = new Set([graphId, outlineId, guideId, aiId].filter(Boolean));
  const remainingResourceEditors = editors
    .filter((editor) => !assigned.has(editor.id))
    .map((editor) => editor.id);

  const leftPaneEditors = [graphId, ...remainingResourceEditors].filter(Boolean);
  const middlePaneEditors = [outlineId].filter(Boolean);
  const rightPaneEditors = [guideId, aiId].filter(Boolean);
  const leftActiveId = leftPaneEditors[0] || null;
  const middleActiveId = middlePaneEditors[0] || null;
  const rightActiveId = rightPaneEditors[0] || null;
  const activePaneId = leftActiveId ? 'pane-left' : middleActiveId ? 'pane-middle' : 'pane-right';
  const activeEditorId = leftActiveId || middleActiveId || rightActiveId || editors[0]?.id || null;

  return {
    ...workbench,
    updatedAt: new Date().toISOString(),
    state: {
      ...workbench.state,
      activeEditorId,
      activeEditorPaneId: activePaneId,
      editorLayout: {
        id: 'split-root',
        type: 'split',
        direction: 'row',
        ratio: 0.34,
        children: [
          {
            id: 'pane-left',
            type: 'leaf',
            editorIds: leftPaneEditors,
            activeEditorId: leftActiveId
          },
          {
            id: 'split-right',
            type: 'split',
            direction: 'row',
            ratio: 0.5,
            children: [
              {
                id: 'pane-middle',
                type: 'leaf',
                editorIds: middlePaneEditors,
                activeEditorId: middleActiveId
              },
              {
                id: 'pane-right',
                type: 'leaf',
                editorIds: rightPaneEditors,
                activeEditorId: rightActiveId
              }
            ]
          }
        ]
      }
    }
  };
});

fs.writeFileSync(workbenchesFile, JSON.stringify(store, null, 2), 'utf8');
console.log('Algorithm Visual Lab set to three-column layout.');
