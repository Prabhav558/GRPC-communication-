"use client";

import { useState, useEffect } from "react";
import "./globals.css";

export default function Home() {
    const [data, setData] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const res = await fetch("/api/data");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            setData(json.data || []);
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
    }, []);

    const formatJson = (jsonStr) => {
        try {
            return JSON.stringify(JSON.parse(jsonStr), null, 2);
        } catch {
            return jsonStr;
        }
    };

    return (
        <div className="container">
            <header className="header">
                <h1>gRPC Data Pipeline</h1>
                <p>Real-time data flowing through mTLS-secured gRPC services</p>
                <div className="pipeline-flow">
                    <span className="pipeline-node">Middleware :3003</span>
                    <span className="pipeline-arrow">→</span>
                    <span className="pipeline-node">Encryption Server :3004</span>
                    <span className="pipeline-arrow">→</span>
                    <span className="pipeline-node">Node Server :3005</span>
                    <span className="pipeline-arrow">→</span>
                    <span className="pipeline-node">Frontend :3000</span>
                </div>
            </header>

            <div className="status-bar">
                <div className="status-left">
                    <div className="status-dot"></div>
                    <span className="status-text">
                        {loading ? "Connecting..." : "Live — auto-refreshing every 2s"}
                    </span>
                </div>
                <span className="status-count">{data.length} entries</span>
            </div>

            {error && <div className="error-state">⚠ Error: {error}</div>}

            {!error && data.length === 0 && !loading && (
                <div className="empty-state">
                    <div className="empty-icon">📡</div>
                    <h3>Waiting for data...</h3>
                    <p>
                        Send JSON to the middleware to see it flow through the pipeline
                    </p>
                    <code>
                        curl -X POST http://localhost:3003/process -H
                        &quot;Content-Type: application/json&quot; -d
                        &apos;&#123;&quot;data&quot;: &#123;&quot;hello&quot;:
                        &quot;world&quot;&#125;&#125;&apos;
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
        </div>
    );
}
