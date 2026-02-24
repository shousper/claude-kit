export function Header() {
  return (
    <header style={{ display: "flex", justifyContent: "space-between", padding: "16px 24px", backgroundColor: "#1a1a2e" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", color: "white" }}>Dashboard</h1>
      <nav style={{ display: "flex", gap: "16px", alignItems: "center" }}>
        <a href="/home" style={{ color: "#e0e0e0", textDecoration: "none" }}>Home</a>
        <a href="/settings" style={{ color: "#e0e0e0", textDecoration: "none" }}>Settings</a>
      </nav>
    </header>
  );
}
