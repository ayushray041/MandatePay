import React from 'react';

interface TableProps {
  headers: string[];
  rows: (React.ReactNode | string | number)[][];
}

export const Table: React.FC<TableProps> = ({ headers, rows }) => (
  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
      <thead className="bg-gray-50 dark:bg-gray-800">
        <tr>
          {headers.map((h, i) => (
            <th
              key={i}
              className="px-4 py-2 text-left text-sm font-medium text-gray-500 dark:text-gray-300"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="bg-white dark:bg-gray-900">
        {rows.map((row, ri) => (
          <tr key={ri} className="odd:bg-gray-50 dark:odd:bg-gray-800">
            {row.map((cell, ci) => (
              <td key={ci} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
