// DbCheck.tsx: a throwaway panel in the main window. Runs in the RENDERER (React).
// It has no database access of its own: every read and write goes through window.pong.
import { useEffect, useState, type FormEvent } from "react";
// Pure functions from shared/ are fine to import here: they don't need Node.
// (Four ../ to climb from windows/main/ up to src/, then into shared/.)
import { periodFor } from "../../../../shared/cutoff";
import { localDate } from "../../../../shared/dates";
import type { DarGrid } from "../../../../shared/cutoff";
import type { Entry } from "../../../../shared/types";

// Phase 1 only: proves renderer -> preload -> main -> SQLite works. Phase 5 removes it.
// Phase 2 adds the "Export to a copy" button.
export default function DbCheck() {
  const today = localDate();

  // useState = a value React remembers between renders; calling the setter redraws the panel.
  const [entries, setEntries] = useState<Entry[]>([]); // today's notes
  const [grid, setGrid] = useState<DarGrid | null>(null); // null until loaded
  const [text, setText] = useState(""); // what's typed in the box
  const [message, setMessage] = useState(""); // seed result or error

  // Reload today's notes and this period's grid from main.
  async function refresh() {
    setEntries(await window.pong.entriesByDate(today));
    setGrid(await window.pong.buildGrid(periodFor(today)));
  }

  // useEffect with [] = run once, right after the panel first appears.
  useEffect(() => {
    refresh();
  }, []);

  // Pressing Enter in the box submits the form.
  async function add(event: FormEvent) {
    event.preventDefault(); // stop the browser's default form submit (a page reload)
    if (!text.trim()) return;
    await window.pong.addEntry({ text, source: "manual" }); // main fills in today's date
    setText(""); // clear the box
    refresh();
  }

  async function seed() {
    // try/catch: if main throws (e.g. the workbook isn't there), the Promise rejects
    // and we show the error instead of crashing.
    try {
      const result = await window.pong.seedFromSample();
      setMessage(
        `Seeded ${result.duties} duties, ${result.outputs} MFOs, ${result.entries} entries.`,
      );
      setGrid(
        await window.pong.buildGrid({ start: "2026-10-03", end: "2026-10-17" }),
      );
    } catch (error) {
      setMessage(String(error));
    }
  }

  // Phase 2: add the grid's cutoff as a new sheet in a copy of the sample workbook
  // (%TEMP%\Pong\MABANO_DAR_copy.xlsx). Main does the work; this only asks and reports.
  async function exportCopy() {
    if (!grid) return;
    setMessage("Exporting... (a few seconds: the whole workbook is rewritten)");
    try {
      const result = await exportOrReplace(grid);
      setMessage(`Added "${result.sheetName}" to ${result.path}`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  // First try without replacing. If that cutoff already has a sheet, ask before
  // overwriting it. confirm() shows a simple OK/Cancel box.
  async function exportOrReplace(g: DarGrid) {
    try {
      return await window.pong.exportDar(g.period, false);
    } catch (error) {
      const exists = String(error).includes("already has a sheet");
      if (!exists || !confirm(`Replace the sheet "${g.sheetName}"?`)) throw error;
      return await window.pong.exportDar(g.period, true);
    }
  }

  // All MFO rows, core and support together, for the summary line.
  const rows = grid
    ? [...grid.core, ...grid.support].flatMap((b) => b.rows)
    : [];

  return (
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
      <h2 style={{ fontSize: 20 }}>DB check</h2>

      {/* A "controlled" input: React holds the value (text) and updates it on every keystroke. */}
      <form onSubmit={add} style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`A note for ${today}`}
          style={{ flex: 1 }}
        />
        <button className="primary" type="submit">
          Add
        </button>
      </form>

      {/* key={e.id} helps React track list items; each one needs a unique key. */}
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {entries.map((e) => (
          <li key={e.id}>
            {e.createdAt.slice(11, 16)} {e.text}
          </li>
        ))}
        {entries.length === 0 && (
          <li style={{ color: "var(--muted)" }}>No notes today yet.</li>
        )}
      </ul>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button onClick={seed}>Seed from sample DAR</button>
        <button onClick={exportCopy} disabled={!grid}>
          Export to a copy
        </button>
        <span style={{ color: "var(--muted)", fontSize: 13.5 }}>{message}</span>
      </div>

      {/* {grid && (...)} = only render this once the grid has loaded. */}
      {grid && (
        <p style={{ margin: 0, fontSize: 13.5 }}>
          <strong>{grid.sheetName}</strong>: {rows.length} MFO rows,{" "}
          {grid.daysAttended} days attended, days off:{" "}
          {grid.days
            .filter((d) => d.off)
            .map((d) => `${d.date.slice(5)} ${d.off}`)
            .join(", ") || "none"}
        </p>
      )}
    </section>
  );
}
