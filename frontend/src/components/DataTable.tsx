interface DataTableProps {
  columns: string[];
  data: Record<string, unknown>[];
  rowCount: number;
}

export default function DataTable({ columns, data, rowCount }: DataTableProps) {
  if (!data || data.length === 0) return null;

  const displayRows = data.slice(0, 100);

  return (
    <div>
      <div className="row-count-label">
        {rowCount} row{rowCount !== 1 ? 's' : ''} returned
        {data.length > 100 ? ' (showing first 100)' : ''}
      </div>
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col}>{String(row[col] ?? '')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
