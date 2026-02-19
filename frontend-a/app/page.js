"use client";

import { useState } from "react";

export default function Home() {
  const [content, setContent] = useState("");
  const [sender, setSender] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!content.trim() || !sender.trim()) return;

    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch("http://localhost:3003/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, sender }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus({ type: "success", text: `✅ Message sent! (ID: ${data.id.slice(0, 8)}...)` });
        setContent("");
      } else {
        setStatus({ type: "error", text: `❌ ${data.message}` });
      }
    } catch (err) {
      setStatus({ type: "error", text: `❌ Connection error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>📤 Server A — Send Messages</h1>
          <p style={styles.subtitle}>
            Messages are sent via REST to Server A, which forwards them to Server B using gRPC
          </p>
        </div>

        <form onSubmit={sendMessage} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Your Name</label>
            <input
              type="text"
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder="Enter your name..."
              style={styles.input}
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Message</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type your message here..."
              rows={4}
              style={{ ...styles.input, ...styles.textarea }}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !content.trim() || !sender.trim()}
            style={{
              ...styles.button,
              ...(loading ? styles.buttonDisabled : {}),
            }}
          >
            {loading ? "⏳ Sending..." : "🚀 Send via gRPC"}
          </button>
        </form>

        {status && (
          <div
            style={{
              ...styles.status,
              ...(status.type === "success" ? styles.statusSuccess : styles.statusError),
            }}
          >
            {status.text}
          </div>
        )}

        <div style={styles.flow}>
          <p style={styles.flowTitle}>Data Flow:</p>
          <code style={styles.flowCode}>
            Frontend A → REST POST → Server A (Rust :3003) → gRPC → Server B (Rust :3004)
          </code>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    padding: "20px",
  },
  card: {
    background: "rgba(255, 255, 255, 0.05)",
    backdropFilter: "blur(20px)",
    borderRadius: "24px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "48px",
    maxWidth: "520px",
    width: "100%",
    boxShadow: "0 25px 50px rgba(0, 0, 0, 0.4)",
  },
  header: { marginBottom: "32px", textAlign: "center" },
  title: { color: "#fff", fontSize: "28px", fontWeight: "700", margin: "0 0 8px" },
  subtitle: { color: "rgba(255,255,255,0.5)", fontSize: "14px", margin: 0, lineHeight: "1.5" },
  form: { display: "flex", flexDirection: "column", gap: "20px" },
  inputGroup: { display: "flex", flexDirection: "column", gap: "6px" },
  label: { color: "rgba(255,255,255,0.7)", fontSize: "13px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" },
  input: {
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: "12px",
    padding: "14px 16px",
    color: "#fff",
    fontSize: "15px",
    outline: "none",
    transition: "border-color 0.2s",
  },
  textarea: { resize: "vertical", minHeight: "100px" },
  button: {
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    border: "none",
    borderRadius: "12px",
    padding: "16px",
    color: "#fff",
    fontSize: "16px",
    fontWeight: "700",
    cursor: "pointer",
    transition: "all 0.3s ease",
    marginTop: "8px",
  },
  buttonDisabled: { opacity: 0.5, cursor: "not-allowed" },
  status: { marginTop: "16px", padding: "14px 18px", borderRadius: "12px", fontSize: "14px", fontWeight: "500" },
  statusSuccess: { background: "rgba(72, 187, 120, 0.15)", color: "#68D391", border: "1px solid rgba(72, 187, 120, 0.3)" },
  statusError: { background: "rgba(245, 101, 101, 0.15)", color: "#FC8181", border: "1px solid rgba(245, 101, 101, 0.3)" },
  flow: { marginTop: "32px", padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.06)" },
  flowTitle: { color: "rgba(255,255,255,0.4)", fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" },
  flowCode: { color: "rgba(255,255,255,0.6)", fontSize: "12px", wordBreak: "break-all" },
};
