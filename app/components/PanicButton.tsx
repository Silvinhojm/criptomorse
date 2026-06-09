"use client";
export function PanicButton() {
  const stop = async () => {
    await fetch("/api/panic", { method: "POST" });
    window.location.reload();
  };
  return (
    <button onClick={stop} style={{
      position: "fixed", top: 12, right: 12, zIndex: 9999,
      background: "#ef4444", color: "#fff", border: "none",
      borderRadius: 10, padding: "8px 16px", fontWeight: 700,
      cursor: "pointer", fontSize: 12
    }}>
      🛑 PANIC STOP
    </button>
  );
}
