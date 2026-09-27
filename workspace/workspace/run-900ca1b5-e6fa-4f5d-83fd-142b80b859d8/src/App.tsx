import React from 'react';

export default function App() {
  const [count, setCount] = React.useState(0);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-2 text-indigo-600">
          Preview Test
        </h1>
        <p className="text-center text-gray-600 mb-6">
          This is a test App.tsx for preview validation
        </p>

        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-gray-700 mb-2">
            <span className="font-semibold">Test ID:</span> run-900ca1b5
          </p>
          <p className="text-sm text-gray-700">
            <span className="font-semibold">Component:</span> Generated from preview validation
          </p>
        </div>

        <div className="text-center mb-6">
          <p className="text-6xl font-bold text-indigo-600 mb-2">{count}</p>
          <p className="text-gray-600">Counter: {count % 2 === 0 ? 'Even' : 'Odd'}</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <button
            onClick={() => setCount(count + 1)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Increment
          </button>
          <button
            onClick={() => setCount(count - 1)}
            className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
          >
            Decrement
          </button>
        </div>

        <button
          onClick={() => setCount(0)}
          className="w-full bg-gray-400 hover:bg-gray-500 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
        >
          Reset
        </button>

        <p className="text-xs text-gray-500 text-center mt-6">
          ✓ File update detection: Modify this file and refresh to see changes
        </p>
      </div>
    </div>
  );
}
