import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'Could not load this section. Check your connection and try again.',
  onRetry,
  className = '',
}) => (
  <div
    role="alert"
    className={`bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 border-l-2 border-l-rose-500 rounded-lg p-4 flex items-start gap-3 ${className}`}
  >
    <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
    <div className="flex-1 min-w-0">
      <p className="text-base text-stone-900 dark:text-stone-100">{title}</p>
      <p className="text-base text-stone-700 dark:text-stone-300 mt-0.5 break-words">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 text-base text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 underline-offset-4 hover:underline"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      )}
    </div>
  </div>
);

export default ErrorState;
