import { Component, type ReactNode, type ErrorInfo } from 'react';
import ErrorState from './ErrorState';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="p-6">
        <ErrorState
          title="This page crashed"
          message={error.message || 'An unexpected error occurred.'}
          onRetry={this.reset}
        />
      </div>
    );
  }
}

export default ErrorBoundary;
