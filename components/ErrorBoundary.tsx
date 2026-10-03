'use client';

import React, { Component, ReactNode } from 'react';
import Icon from '@/components/Icon';
import Button from './Button';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
            <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400">
              <Icon name="alert" size={28} />
            </span>
            <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">
              Something went wrong
            </h1>
            <p className="mb-6 text-muted-foreground">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
