import { Component, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
        <p className="text-label-l text-fg-primary">Something went wrong on this screen.</p>
        <p className="text-body-s text-fg-secondary max-w-md break-words">{this.state.error.message}</p>
        <Button className="hover:bg-action-primary-hover" onClick={this.reset}>
          <RotateCcw aria-hidden /> Back to library
        </Button>
      </div>
    );
  }
}
