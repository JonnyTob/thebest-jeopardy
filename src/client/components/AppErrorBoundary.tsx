import { Component, type ErrorInfo, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Quiz Night could not render:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="landing"><section className="panel" role="alert">
      <h1>Quiz Night could not start</h1>
      <p>Reload this page. If it still fails, update iOS/Safari and share the error below with the host.</p>
      <p><code>{this.state.error.message || String(this.state.error)}</code></p>
      <button onClick={() => window.location.reload()}>Reload</button>
    </section></main>;
  }
}