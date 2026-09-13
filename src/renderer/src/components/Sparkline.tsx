// Minimal inline SVG trend line for a stat tile — a rolling window of
// recent percent values (0-100), no axes/gridlines/legend: a single series
// whose panel title already names it. Internal coordinate space is fixed
// (viewBox) and the element scales to its container via CSS, so callers
// never need to know pixel width.
interface SparklineProps {
  values: number[];
  color: string;
}

const VIEW_WIDTH = 200;
const VIEW_HEIGHT = 40;

export default function Sparkline({ values, color }: SparklineProps) {
  if (values.length < 2) {
    return <svg className="sparkline" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} />;
  }

  const stepX = VIEW_WIDTH / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = VIEW_HEIGHT - (Math.max(0, Math.min(100, v)) / 100) * VIEW_HEIGHT;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M${points.join(" L")}`;
  const areaPath = `${linePath} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`;

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      preserveAspectRatio="none"
    >
      <path d={areaPath} fill={color} opacity={0.1} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
