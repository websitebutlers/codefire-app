import { Component, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm font-medium text-neutral-300">
            {this.props.fallbackLabel || 'Something went wrong'}
          </p>
          <p className="text-xs text-neutral-500 text-center max-w-sm">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={this.handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-cf text-xs font-medium
                       bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            <RotateCcw size={12} />
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
