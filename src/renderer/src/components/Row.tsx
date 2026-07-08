interface RowProps {
  dotClassName?: string;
  name: string;
  status: string;
}

export default function Row({ dotClassName = "", name, status }: RowProps) {
  return (
    <div className="row">
      <span className={`dot ${dotClassName}`}></span>
      <span className="name">{name}</span>
      <span className="status">{status}</span>
    </div>
  );
}
