import { Component, type ReactNode } from "react";
import { Button } from "@novasamatech/tr-ui";
import { RotateCcw } from "lucide-react";

type Props = { children: ReactNode; onReset: () => void };
type State = { error: Error | null };

/**
 * Catches render/effect crashes in the screen area (notably the HLS player) so a
 * single failure shows a recoverable message instead of unmounting the whole
 * React tree to a black screen that needs a full reload. The parent gives this a
 * `key` per screen, so navigating away remounts it clean.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    console.error("[AnyTub3] screen crash:", error);
  }

  private readonly reset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-fg-primary font-medium">Something went wrong on this screen.</p>
        <p className="text-fg-secondary max-w-md text-sm break-words">{this.state.error.message}</p>
        <Button onClick={this.reset}>
          <RotateCcw /> Back to library
        </Button>
      </div>
    );
  }
}
