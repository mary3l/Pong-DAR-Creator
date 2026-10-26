// MainWindow.tsx: what the main window shows. Runs in the RENDERER.
// main.tsx picks this screen when the URL says ?window=main.
import Pong from "../../components/Pong";
import DbCheck from "./DbCheck"; // new in Phase 1

// Phase 0 placeholder with dev buttons. Phase 5 builds Today and Cutoff from docs/design/boards/App.dc.html.
export default function MainWindow() {
  return (
    <main
      style={{
        padding: 32,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        maxWidth: 720,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Pong mood="peek" size={64} />
        <div>
          <h1 style={{ fontSize: 30 }}>Pong DAR Buddy</h1>
          <span style={{ color: "var(--muted)" }}>
            Phase 0 scaffold. Today, Cutoff and Settings arrive in Phases 5 and
            7.
          </span>
        </div>
      </header>

      <section
        style={{
          background: "#ffffff",
          border: "1px solid var(--line)",
          borderRadius: 16,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 20 }}>Dev buttons</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>
          Each button calls window.pong (preload), which asks the main process
          to show or hide a window.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="primary"
            onClick={() => window.pong.showWindow("pong")}
          >
            Show pong
          </button>
          <button onClick={() => window.pong.hideWindow("pong")}>
            Hide pong
          </button>
          <button
            className="primary"
            onClick={() => window.pong.showWindow("checkin")}
          >
            Show check-in
          </button>
        </div>
      </section>

      {/* New in Phase 1: the panel from DbCheck.tsx, under the dev buttons. */}
      <DbCheck />
    </main>
  );
}
