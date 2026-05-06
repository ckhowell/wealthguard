import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

function Boom(): never {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <p>hello</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders the fallback UI when a child throws', () => {
    // Swallow the React error log for this test.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/boom/i)).toBeInTheDocument();
    err.mockRestore();
  });
});
