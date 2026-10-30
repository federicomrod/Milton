"use client";

// R1-15j: a Desglose that cannot be drawn must never take the page down. It
// shows a short message and a way back; the error goes to the console with
// the dish's name so it can be found.

import { Component, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";

function DrillFallback({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  const { d, fmt } = useT();
  const s = d.menu.screens.drillBoundary;
  return (
    <div
      role="alert"
      className="space-y-3 rounded-[14px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-4 text-[13px]"
    >
      <p className="font-semibold">{fmt(s.title, { title })}</p>
      <p className="text-[#5b6476]">{s.body}</p>
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg bg-[#1b40c8] px-3 py-1.5 font-semibold text-white"
      >
        {s.back}
      </button>
    </div>
  );
}

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
      <DrillFallback title={this.props.title} onBack={this.props.onBack} />
    );
  }
}
