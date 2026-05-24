// Standalone dockhand mobile layout — no admin shell, no agent bar.
// The app-shell short-circuits on /dock/* to render just this.

export default function DockLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-canvas">{children}</div>;
}
