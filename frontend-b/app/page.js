"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [lastPoll, setLastPoll] = useState(null);

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await fetch("/api/messages");
        const data = await res.json();

        if (data.messages) {
          setMessages(data.messages);
          setError(null);
        } else if (data.error) {
          setError(data.error);
        }
        setLastPoll(new Date().toLocaleTimeString());
      } catch (err) {
        setError(`Connection error: ${err.message}`);
        setLastPoll(new Date().toLocaleTimeString());
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatTimestamp = (ts) => {
    if (!ts) return "";
    const date = new Date(Number(ts) * 1000);
    return date.toLocaleTimeString();
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>📥 Server B — Received Messages</h1>
          <p style={styles.subtitle}>
            Messages arrive via gRPC from Server A and are displayed here
          </p>
          <div style={styles.statusBar}>
            <span style={styles.dot} />
            <span style={styles.statusText}>
              Polling every 2s {lastPoll ? `• Last: ${lastPoll}` : ""}
            </span>
          </div>
        </div>

        {error && (
          <div style={styles.error}>
            ❌ {error}
          </div>
        )}

        <div style={styles.messageList}>
          {messages.length === 0 ? (
            <div style={styles.empty}>
              <span style={styles.emptyIcon}>💬</span>
              <p style={styles.emptyText}>No messages yet</p>
              <p style={styles.emptyHint}>
                Send a message from Frontend A (port 3002) to see it appear here!
              </p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={msg.id || i} style={styles.message}>
                <div style={styles.msgHeader}>
                  <span style={styles.msgSender}>👤 {msg.sender}</span>
                  <span style={styles.msgTime}>{formatTimestamp(msg.timestamp)}</span>
                </div>
                <p style={styles.msgContent}>{msg.content}</p>
                <span style={styles.msgId}>ID: {msg.id?.slice(0, 8)}...</span>
              </div>
            ))
          )}
        </div>

        <div style={styles.counter}>
          {messages.length} message{messages.length !== 1 ? "s" : ""} received
        </div>

        <div style={styles.flow}>
          <p style={styles.flowTitle}>Data Flow:</p>
          <code style={styles.flowCode}>
            Server A → gRPC → Server B (Rust :3004) → gRPC client → Frontend B API route → UI
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
    background: "linear-gradient(135deg, #0a192f 0%, #112240 50%, #1a365d 100%)",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
    padding: "20px",
  },
  card: {
    background: "rgba(255, 255, 255, 0.05)",
    backdropFilter: "blur(20px)",
    borderRadius: "24px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "48px",
    maxWidth: "580px",
    width: "100%",
    boxShadow: "0 25px 50px rgba(0, 0, 0, 0.4)",
  },
  header: { marginBottom: "24px", textAlign: "center" },
  title: { color: "#fff", fontSize: "28px", fontWeight: "700", margin: "0 0 8px" },
  subtitle: { color: "rgba(255,255,255,0.5)", fontSize: "14px", margin: "0 0 16px", lineHeight: "1.5" },
  statusBar: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" },
  dot: { width: "8px", height: "8px", borderRadius: "50%", background: "#48bb78", boxShadow: "0 0 8px #48bb78", animation: "pulse 2s infinite" },
  statusText: { color: "rgba(255,255,255,0.4)", fontSize: "12px" },
  error: { padding: "14px 18px", borderRadius: "12px", background: "rgba(245,101,101,0.15)", color: "#FC8181", border: "1px solid rgba(245,101,101,0.3)", marginBottom: "16px", fontSize: "14px" },
  messageList: { display: "flex", flexDirection: "column", gap: "12px", maxHeight: "400px", overflowY: "auto", paddingRight: "4px" },
  empty: { textAlign: "center", padding: "48px 20px" },
  emptyIcon: { fontSize: "48px" },
  emptyText: { color: "rgba(255,255,255,0.5)", fontSize: "18px", margin: "16px 0 8px" },
  emptyHint: { color: "rgba(255,255,255,0.3)", fontSize: "13px" },
  message: {
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "16px",
    padding: "18px",
    transition: "all 0.2s ease",
  },
  msgHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" },
  msgSender: { color: "#63b3ed", fontSize: "14px", fontWeight: "600" },
  msgTime: { color: "rgba(255,255,255,0.3)", fontSize: "12px" },
  msgContent: { color: "#fff", fontSize: "15px", margin: "0 0 8px", lineHeight: "1.5" },
  msgId: { color: "rgba(255,255,255,0.2)", fontSize: "11px", fontFamily: "monospace" },
  counter: { textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "13px", marginTop: "16px", padding: "8px" },
  flow: { marginTop: "24px", padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.06)" },
  flowTitle: { color: "rgba(255,255,255,0.4)", fontSize: "11px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" },
  flowCode: { color: "rgba(255,255,255,0.6)", fontSize: "12px", wordBreak: "break-all" },
};
