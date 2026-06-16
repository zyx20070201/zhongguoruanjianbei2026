import OpenWebUIMarkdownPreview, { OpenWebUICitationSource } from '../components/workbench/OpenWebUIMarkdownPreview';

const citationSources: OpenWebUICitationSource[] = [
  {
    sourceId: '1',
    fileId: 'heap-sort.md',
    fileName: 'heap-sort.md',
    label: 'Heap sort notes',
    preview: 'Binary heap properties and heapify procedure.'
  },
  {
    sourceId: '2',
    fileId: 'sql-homework.sql',
    fileName: 'sql-homework.sql',
    label: 'SQL homework',
    preview: 'Example SQL statements and schema fragments.'
  }
];

const cases = [
  {
    title: 'Typography And Inline',
    content: [
      '# 一级标题 Heading 1',
      '## 二级标题 Heading 2',
      '这是一段中英文混排内容，包含 **bold**, *italic*, ~~delete~~, `inline code`, [OpenAI](https://openai.com), citation [1] and [2].',
      '',
      '> 普通 blockquote 应该有细边线、正常字体、不挤压正文。',
      '',
      '---',
      '',
      '- 无序列表第一项',
      '- 第二项包含 `code` 和 [1]',
      '  - 嵌套项目',
      '1. 有序列表一',
      '2. 有序列表二'
    ].join('\n')
  },
  {
    title: 'Loose LLM Lists',
    content: [
      '十、**Ordering the Output：ORDER BY 排序**',
      '-课件把 `ORDER BY` 单独成节，并特别说明它位于 `WHERE` 等其他子句之后。',
      '-你要抓住它的本质：**排序不改变选出了哪些数据，只改变这些数据的显示顺序。**',
      '-你需要掌握：- `ASC`：升序；- `DESC`：降序；- 可以按一个或多个列排序。',
      '',
      '最相关依据：',
      '1.06-SQL-1_2026.pdf: The where Clause',
      '2.06-SQL-1_2026.pdf: HAVING Clauses',
      '3.06-SQL-1_2026.pdf: The ORDER BY clause follows the WHERE clause and any other clause'
    ].join('\n')
  },
  {
    title: 'Code Blocks',
    content: [
      '无语言代码块：',
      '',
      '```',
      'plain text line 1',
      'plain text line 2 with a very very very very very very very very long line that should scroll instead of escaping the message width',
      '```',
      '',
      'C 代码块：',
      '',
      '```c',
      '#include <stdio.h>',
      '',
      'void heapify(int arr[], int n, int i) {',
      '    int largest = i;',
      '    int left = 2 * i + 1;',
      '    int right = 2 * i + 2;',
      '',
      '    if (left < n && arr[left] > arr[largest])',
      '        largest = left;',
      '',
      '    if (right < n && arr[right] > arr[largest])',
      '        largest = right;',
      '',
      '    if (largest != i) {',
      '        int temp = arr[i];',
      '        arr[i] = arr[largest];',
      '        arr[largest] = temp;',
      '        heapify(arr, n, largest);',
      '    }',
      '}',
      '```',
      '',
      'SQL 代码块：',
      '',
      '```sql',
      'SELECT employee_id, person_name',
      'FROM employee',
      'WHERE salary > 10000',
      'ORDER BY salary DESC;',
      '```'
    ].join('\n')
  },
  {
    title: 'Bare Python Recovery',
    content: [
      '下面是一段模型偶尔会输出的裸 Python，应该整体恢复成代码块，而不是只把缩进行拆出去：',
      '',
      'def heapify(arr, n, i):',
      '    largest = i',
      '    left = 2 * i + 1',
      '    right = 2 * i + 2',
      '',
      '    if left < n and arr[left] > arr[largest]:',
      '        largest = left',
      '',
      '    if right < n and arr[right] > arr[largest]:',
      '        largest = right',
      '',
      '    if largest != i:',
      '        arr[i], arr[largest] = arr[largest], arr[i]',
      '        heapify(arr, n, largest)',
      '',
      'def heap_sort(arr):',
      '    n = len(arr)',
      '',
      '    for i in range(n // 2 - 1, -1, -1):',
      '        heapify(arr, n, i)',
      '',
      '    for i in range(n - 1, 0, -1):',
      '        arr[i], arr[0] = arr[0], arr[i]',
      '        heapify(arr, i, 0)',
      '',
      '    return arr',
      '',
      'nums = [4, 10, 3, 5, 1]'
    ].join('\n')
  },
  {
    title: 'Tables',
    content: [
      '| 文件 | 状态 | 说明 |',
      '| --- | ---: | --- |',
      '| `1.py` | ✅ | Python 示例 |',
      '| `homework.sql` | ⚠️ | 片段过短，需要上下文 [2] |',
      '',
      '| very long header | another long header |',
      '| --- | --- |',
      '| a very very very very very very long cell that should keep the table horizontally scrollable | value |'
    ].join('\n')
  },
  {
    title: 'Math',
    content: [
      'Inline math: $O(n \\log n)$ should render in line.',
      '',
      '$$',
      '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
      '$$'
    ].join('\n')
  },
  {
    title: 'Mermaid And Details',
    content: [
      '```mermaid',
      'flowchart TD',
      '  A[Start] --> B{Heap property?}',
      '  B -->|No| C[Heapify]',
      '  B -->|Yes| D[Done]',
      '```',
      '',
      '<details>',
      '<summary>Reasoning details</summary>',
      '',
      '内部 markdown **应该继续渲染**，并且 `code` 不应该溢出。',
      '',
      '```python',
      'print("hello")',
      '```',
      '</details>'
    ].join('\n')
  }
];

export default function MarkdownAcceptancePage() {
  return (
    <div className="h-full overflow-y-auto bg-[#fbfbfa] px-8 py-8 text-gray-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">OpenWebUI Markdown Acceptance</p>
          <h1 className="mt-2 text-2xl font-semibold">Markdown 渲染验收页</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
            用固定 fixture 检查 terminal markdown 的标题、列表、代码块、表格、数学公式、Mermaid、details 和引用渲染。
          </p>
        </header>

        {cases.map((item) => (
          <section key={item.title} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <h2 className="mb-4 border-b border-gray-100 pb-3 text-sm font-semibold text-gray-500">{item.title}</h2>
            <OpenWebUIMarkdownPreview
              content={item.content}
              citationSources={citationSources}
              onCitationJump={(source) => {
                console.log('citation', source);
              }}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
