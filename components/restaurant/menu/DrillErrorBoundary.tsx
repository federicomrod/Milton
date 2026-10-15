"use client";

// R1-15j: a Desglose that cannot be drawn must never take the page down. It
// shows a short message and a way back; the error goes to the console with
// the dish's name so it can be found.

import { Component, type ReactNode } from "react";

interface State {
  failed: boolean;
}

export class DrillErrorBoundary extends Component<
  { title: string; onBack: () => void; children?: ReactNode },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[desglose] «${this.props.title}»:`, error);
  }

  componentDidUpdate(prev: { title: string }) {
    // Another dish or group: try again.
    if (prev.title !== this.props.title && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="space-y-3 rounded-[14px] border border-[#f5c98b] bg-[#fff8ec] px-4 py-4 text-[13px]"
      >
        <p className="font-semibold">
          No pude mostrar el desglose de «{this.props.title}».
        </p>
        <p className="text-[#5b6476]">
          El resto de Platos sigue funcionando. Si pasa de nuevo con este plato,
          avísanos con su nombre.
        </p>
        <button
          type="button"
          onClick={this.props.onBack}
          className="rounded-lg bg-[#1b40c8] px-3 py-1.5 font-semibold text-white"
        >
          ← Volver a Platos
        </button>
      </div>
    );
  }
}
