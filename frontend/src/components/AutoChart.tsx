import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface AutoChartProps {
  columns: string[];
  data: Record<string, unknown>[];
}

const COLORS = ['#FF3621', '#1a1a2e', '#4ECDC4', '#FFE66D', '#95E1D3', '#F38181', '#AA96DA', '#A8D8EA'];

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return !isNaN(Number(value)) && value.trim() !== '';
  return false;
}

function isDateLike(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value) || /^\d{2}[-/]\d{2}[-/]\d{4}/.test(value);
}

type ChartType = 'bar' | 'line' | 'pie' | 'none';

function detectChartType(
  columns: string[],
  data: Record<string, unknown>[]
): { type: ChartType; categoryCol: string; valueCol: string } {
  if (!data.length || columns.length < 2) {
    return { type: 'none', categoryCol: '', valueCol: '' };
  }

  const sample = data.slice(0, 5);

  const numericCols = columns.filter((col) =>
    sample.every((row) => isNumeric(row[col]))
  );
  const stringCols = columns.filter((col) => !numericCols.includes(col));
  const dateCols = stringCols.filter((col) =>
    sample.some((row) => isDateLike(row[col]))
  );

  // Date + numeric -> Line chart
  if (dateCols.length >= 1 && numericCols.length >= 1) {
    return { type: 'line', categoryCol: dateCols[0], valueCol: numericCols[0] };
  }

  // 1 string + 1 numeric -> Bar chart
  if (stringCols.length >= 1 && numericCols.length >= 1) {
    // Pie chart for few rows with 1 numeric column
    if (numericCols.length === 1 && data.length <= 8) {
      return { type: 'pie', categoryCol: stringCols[0], valueCol: numericCols[0] };
    }
    return { type: 'bar', categoryCol: stringCols[0], valueCol: numericCols[0] };
  }

  return { type: 'none', categoryCol: '', valueCol: '' };
}

export default function AutoChart({ columns, data }: AutoChartProps) {
  if (!data || data.length === 0) return null;

  const chartData = data.slice(0, 50).map((row) => {
    const newRow: Record<string, unknown> = {};
    for (const col of columns) {
      const val = row[col];
      newRow[col] = isNumeric(val) ? Number(val) : val;
    }
    return newRow;
  });

  const { type, categoryCol, valueCol } = detectChartType(columns, data);

  if (type === 'none') return null;

  return (
    <div className="chart-wrapper">
      <ResponsiveContainer width="100%" height={280}>
        {type === 'bar' ? (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis
              dataKey={categoryCol}
              tick={{ fontSize: 12 }}
              interval={0}
              angle={chartData.length > 8 ? -45 : 0}
              textAnchor={chartData.length > 8 ? 'end' : 'middle'}
              height={chartData.length > 8 ? 80 : 30}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey={valueCol} fill="#FF3621" radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : type === 'line' ? (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey={categoryCol} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={valueCol}
              stroke="#FF3621"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        ) : (
          <PieChart>
            <Tooltip />
            <Legend />
            <Pie
              data={chartData}
              dataKey={valueCol}
              nameKey={categoryCol}
              cx="50%"
              cy="50%"
              outerRadius={100}
              label
            >
              {chartData.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
