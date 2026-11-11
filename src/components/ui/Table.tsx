import React from 'react';

interface TableProps {
  headers: string[];
  rows: (React.ReactNode | string | number)[][];
  caption: string;
  emptyMessage?: string;
}

export const Table: React.FC<TableProps> = ({
  headers,
  rows,
  caption,
  emptyMessage = 'No records available.',
}) => (
  <div className="overflow-x-auto border-y border-mp-warm-grey">
    <table aria-label={caption} className="w-full min-w-[42rem] border-collapse text-left">
      <thead className="bg-mp-app-bg">
        <tr className="border-b border-mp-warm-grey">
          {headers.map((header) => (
            <th
              key={header}
              scope="col"
              className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-mp-medium-grey"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="bg-mp-surface">
        {rows.length ? (
          rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-mp-warm-grey last:border-0">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 text-sm text-mp-ink">
                  {cell}
                </td>
              ))}
            </tr>
          ))
        ) : (
          <tr>
            <td
              colSpan={headers.length}
              className="px-4 py-12 text-center text-sm text-mp-medium-grey"
            >
              {emptyMessage}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);
