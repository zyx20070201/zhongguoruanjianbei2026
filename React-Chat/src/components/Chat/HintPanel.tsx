interface HintPanelProps {
  onHintClick: (text: string) => void;
}

const HINTS = [
  '用 React 做一个待办事项应用',
  '用 Recharts 画一个折线图展示数据趋势',
  '做一个交互式的颜色调色板工具',
  '用 Chart.js 画一个柱状图展示季度销售',
];

export function HintPanel({ onHintClick }: HintPanelProps) {
  return (
    <div className="hint">
      <h2>React Sandbox — 兼容所有中转站</h2>
      <p>
        无需 Tool Use，通过标记约定实现可视化
        <br />
        支持 HTML + React 两种模式
      </p>
      <div className="hint-ch">
        {HINTS.map((hint, i) => (
          <button key={i} className="h-c" onClick={() => onHintClick(hint)}>
            {hint}
          </button>
        ))}
      </div>
    </div>
  );
}
