import React from 'react';

interface CardProps {
  title: string;
  value: React.ReactNode | string | number;
}

export const Card: React.FC<CardProps> = ({ title, value }) => (
  <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{title}</h3>
    <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">{value}</p>
  </div>
);
