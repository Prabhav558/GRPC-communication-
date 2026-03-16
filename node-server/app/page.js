"use client";

import { useState, useEffect } from "react";
import "./globals.css";

// ── Sub-components ──────────────────────────────────────────────────────────

function DatabaseSchemaView({ metadata, databases, selectedDb, onDbChange }) {
    const selectorHtml = (
        <div className="db-selector" style={{ marginBottom: "1rem" }}>
            <label style={{ fontWeight: 600, marginRight: "0.5rem", color: "var(--foreground)" }}>
                Select Database:
            </label>
            <select
                value={selectedDb}
                onChange={onDbChange}
                style={{
                    padding: "0.5rem", borderRadius: "6px", backgroundColor: "var(--bg-card)",
                    border: "1px solid var(--border)", color: "var(--foreground)", fontSize: "0.9rem"
                }}
            >
                {databases.map(db => <option key={db} value={db}>{db}</option>)}
            </select>
        </div>
    );

    if (!metadata) {
        return (
            <div className="empty-state">
                {selectorHtml}
                <div className="empty-icon">🗄️</div>
                <h3>Loading metadata for {selectedDb}...</h3>
                <p>Or trigger a fetch manually:</p>
                <code>curl http://localhost:3003/db/metadata?db={selectedDb}</code>
            </div>
        );
    }

    const { database_info, tables, last_updated } = metadata;

    return (
        <div className="db-schema-view">
            {selectorHtml}
            {/* Database overview card */}
            <div className="db-info-card">
                <div className="db-info-header">
                    <h2 className="db-name">🗄️ {database_info?.database_name}</h2>
                    <span className="db-updated">Updated: {last_updated ? new Date(last_updated).toLocaleTimeString() : "—"}</span>
                </div>
                <div className="db-stats">
                    <div className="db-stat">
                        <span className="stat-label">Size</span>
                        <span className="stat-value">{database_info?.database_size || "—"}</span>
                    </div>
                    <div className="db-stat">
                        <span className="stat-label">Tables</span>
                        <span className="stat-value">{database_info?.table_count ?? "—"}</span>
                    </div>
                    <div className="db-stat">
                        <span className="stat-label">Engine</span>
                        <span className="stat-value postgres-badge">PostgreSQL</span>
                    </div>
                    <div className="db-stat stat-version">
                        <span className="stat-label">Version</span>
                        <span className="stat-value version-text">{database_info?.postgres_version?.split(" ").slice(0, 2).join(" ") || "—"}</span>
                    </div>
                </div>
            </div>

            {/* Tables list */}
            <h3 className="section-title">Tables ({tables?.length || 0})</h3>
            <div className="tables-grid">
                {(tables || []).map((table) => (
                    <div key={`${table.schema_name}.${table.table_name}`} className="table-card">
                        <div className="table-card-header">
                            <div>
                                <span className="table-schema">{table.schema_name}.</span>
                                <span className="table-name">{table.table_name}</span>
                            </div>
                            <div className="table-meta">
                                <span className="table-badge">{table.row_count} rows</span>
                                <span className="table-badge size-badge">{table.table_size}</span>
                            </div>
                        </div>
                        <div className="columns-list">
                            {(table.columns || []).map((col) => (
                                <div key={col.column_name} className="column-row">
                                    <span className="col-name">{col.column_name}</span>
                                    <span className="col-type">{col.data_type}</span>
                                    {!col.is_nullable && <span className="col-badge not-null">NOT NULL</span>}
                                    {col.default_value && <span className="col-badge default">DEFAULT</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function CdcEventsView({ events, total }) {
    const opColor = { INSERT: "#10b981", UPDATE: "#6366f1", DELETE: "#ef4444" };

    const safeParse = (str) => {
        if (!str) return null;
        try { return JSON.parse(str); } catch { return str; }
    };

    if (!events || events.length === 0) {
        return (
            <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <h3>No CDC events yet</h3>
                <p>Make a change to the database to see live events appear here:</p>
                <code>
                    docker exec -it grpc-postgres-1 psql -U pipeline_user -d pipeline_db<br />
                    INSERT INTO app_data.users (username, email) VALUES (&apos;charlie&apos;, &apos;charlie@example.com&apos;);
                </code>
            </div>
        );
    }

    return (
        <div className="cdc-view">
            <div className="cdc-header">
                <h3 className="section-title">Live Change Events</h3>
                <span className="cdc-total">{total} total events captured</span>
            </div>
            <div className="events-list">
                {events.map((event, i) => {
                    const before = safeParse(event.before_data);
                    const after = safeParse(event.after_data);
                    return (
                        <div key={event.event_id || i} className="event-card">
                            <div className="event-header">
                                <span
                                    className="op-badge"
                                    style={{ background: opColor[event.operation] || "#888" }}
                                >
                                    {event.operation}
                                </span>
                                <span className="event-table">
                                    {event.schema_name}.{event.table_name}
                                </span>
                                <span className="event-time">
                                    {event.received_at
                                        ? new Date(event.received_at).toLocaleTimeString()
                                        : "—"}
                                </span>
                                {event.lsn && <span className="event-lsn">LSN: {event.lsn}</span>}
                            </div>

                            {/* Data diff / content */}
                            {event.operation === "UPDATE" && before && after && (
                                <div className="event-diff">
                                    <div className="diff-before">
                                        <span className="diff-label">Before</span>
                                        <pre>{JSON.stringify(before, null, 2)}</pre>
                                    </div>
                                    <div className="diff-after">
                                        <span className="diff-label">After</span>
                                        <pre>{JSON.stringify(after, null, 2)}</pre>
                                    </div>
                                </div>
                            )}
                            {event.operation === "INSERT" && after && (
                                <div className="event-data">
                                    <span className="diff-label">New row</span>
                                    <pre>{JSON.stringify(after, null, 2)}</pre>
                                </div>
                            )}
                            {event.operation === "DELETE" && before && (
                                <div className="event-data deleted">
                                    <span className="diff-label">Deleted row</span>
                                    <pre>{JSON.stringify(before, null, 2)}</pre>
                                </div>
                            )}

                            <div className="event-footer">
                                <span className="event-id-text">ID: {event.event_id || "—"}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function Home() {
    const [data, setData] = useState([]);
    const [dbMetadata, setDbMetadata] = useState(null);
    const [databases, setDatabases] = useState(["pipeline_db"]);
    const [selectedDb, setSelectedDb] = useState("pipeline_db");
    const [cdcEvents, setCdcEvents] = useState([]);
    const [cdcTotal, setCdcTotal] = useState(0);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("pipeline");

    const fetchData = async () => {
        try {
            const [pRes, dbRes, cdcRes, dbsRes] = await Promise.all([
                fetch("/api/data"),
                fetch(`/api/db-metadata?db=${encodeURIComponent(selectedDb)}`),
                fetch("/api/cdc-events?limit=100"),
                fetch("/api/databases"),
            ]);

            if (!pRes.ok) throw new Error(`HTTP ${pRes.status}`);

            const pJson = await pRes.json();
            setData(pJson.data || []);

            if (dbRes.ok) {
                const dbJson = await dbRes.json();
                setDbMetadata(dbJson.metadata || null);
            }

            if (cdcRes.ok) {
                const cdcJson = await cdcRes.json();
                setCdcEvents(cdcJson.events || []);
                setCdcTotal(cdcJson.total || 0);
            }

            if (dbsRes.ok) {
                const dbsJson = await dbsRes.json();
                if (dbsJson.success && dbsJson.databases) {
                    setDatabases(dbsJson.databases);
                }
            }

            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 2000);
        return () => clearInterval(interval);
    }, [selectedDb]);

    const handleDbChange = async (e) => {
        const newDb = e.target.value;
        setSelectedDb(newDb);
        setDbMetadata(null); // clear until fetched
        try {
            await fetch(`/api/trigger-db-fetch?db=${encodeURIComponent(newDb)}`);
            // It will be picked up on the next interval poll or immediately if we call fetchData()
            fetchData();
        } catch (err) {
            console.error("Failed to trigger DB fetch:", err);
        }
    };

    const formatJson = (jsonStr) => {
        try { return JSON.stringify(JSON.parse(jsonStr), null, 2); }
        catch { return jsonStr; }
    };

    const tabs = [
        { id: "pipeline", label: "Pipeline Data", count: data.length },
        { id: "database", label: "Database Schema", count: dbMetadata ? 1 : 0 },
        { id: "cdc", label: "CDC Events", count: cdcTotal },
    ];

    return (
        <div className="container">
            <header className="header">
                <h1>gRPC Database Pipeline</h1>
                <p>Real-time database monitoring with CDC — secured by mTLS</p>
                <div className="pipeline-flow">
                    <span className="pipeline-node">DB :5432</span>
                    <span className="pipeline-arrow">↓ WAL</span>
                    <span className="pipeline-node">CDC :8080</span>
                    <span className="pipeline-arrow">→</span>
                    <span className="pipeline-node">Middleware :3003/:3006</span>
                    <span className="pipeline-arrow">→</span>
                    <span className="pipeline-node">Encryption :3004</span>
                    <span className="pipeline-arrow">→</span>
                    <span className="pipeline-node">Node :3005</span>
                    <span className="pipeline-arrow">→</span>
                    <span className="pipeline-node">Frontend :3000</span>
                </div>
            </header>

            {/* Status bar */}
            <div className="status-bar">
                <div className="status-left">
                    <div className="status-dot"></div>
                    <span className="status-text">
                        {loading ? "Connecting..." : "Live — auto-refreshing every 2s"}
                    </span>
                </div>
                <div className="status-right">
                    <span className="status-badge">{data.length} messages</span>
                    <span className="status-badge db-badge">{dbMetadata ? "DB connected" : "DB pending"}</span>
                    <span className="status-badge cdc-badge">{cdcTotal} CDC events</span>
                </div>
            </div>

            {error && <div className="error-state">⚠ Error: {error}</div>}

            {/* Tab navigation */}
            <div className="tab-nav">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`tab-btn${activeTab === tab.id ? " active" : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className="tab-count">{tab.count}</span>
                        )}
                    </button>
                ))}
            </div>

            {/* ── Pipeline Data tab ── */}
            {activeTab === "pipeline" && (
                <>
                    {!error && data.length === 0 && !loading && (
                        <div className="empty-state">
                            <div className="empty-icon">📡</div>
                            <h3>Waiting for data...</h3>
                            <p>Send JSON to the middleware to see it flow through the pipeline</p>
                            <code>
                                curl -X POST http://localhost:3003/process -H &quot;Content-Type: application/json&quot; -d &apos;&#123;&quot;data&quot;: &#123;&quot;hello&quot;: &quot;world&quot;&#125;&#125;&apos;
                            </code>
                        </div>
                    )}
                    <div className="data-list">
                        {[...data].reverse().map((item, i) => (
                            <div key={item.display_id || i} className="data-card">
                                <div className="data-card-header">
                                    <span className="data-card-id">{item.display_id}</span>
                                    <span className="data-card-time">{item.received_at}</span>
                                </div>
                                <div className="data-card-content">
                                    <pre>{formatJson(item.json_data)}</pre>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* ── Database Schema tab ── */}
            {activeTab === "database" && (
                <DatabaseSchemaView
                    metadata={dbMetadata}
                    databases={databases}
                    selectedDb={selectedDb}
                    onDbChange={handleDbChange}
                />
            )}

            {/* ── CDC Events tab ── */}
            {activeTab === "cdc" && (
                <CdcEventsView events={cdcEvents} total={cdcTotal} />
            )}
        </div>
    );
}
