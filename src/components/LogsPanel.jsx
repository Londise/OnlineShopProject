import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { api } from "../services/api";

const LEVEL_LABELS = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const LEVEL_OPTIONS = ["trace", "debug", "info", "warn", "error", "fatal"];

const formatTs = (ts) =>
  new Date(ts).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

export default function LogsPanel() {
  const [entries, setEntries] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState("");
  const [service, setService] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [traceId, setTraceId] = useState("");
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());

  const filtersRef = useRef({ level, service, query, traceId });
  filtersRef.current = { level, service, query, traceId };

  const fetchLogs = useCallback(async ({ cursor, append } = {}) => {
    const current = filtersRef.current;
    const params = { limit: 60 };
    if (current.level) params.level = current.level;
    if (current.service) params.service = current.service;
    if (current.query) params.q = current.query;
    if (current.traceId) params.traceId = current.traceId;
    if (cursor) params.cursor = cursor;
    const result = await api.admin.logs(params);
    setEntries((previous) =>
      append ? [...previous, ...result.entries] : result.entries,
    );
    setNextCursor(result.nextCursor);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await fetchLogs();
    } catch (err) {
      setError(err?.message || "Não foi possível carregar os logs.");
    } finally {
      setLoading(false);
    }
  }, [fetchLogs]);

  useEffect(() => {
    reload();
  }, [reload, level, service, query, traceId]);

  useEffect(() => {
    if (!live) return undefined;
    const handle = setInterval(() => {
      fetchLogs().catch(() => {});
    }, 3000);
    return () => clearInterval(handle);
  }, [live, fetchLogs]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError("");
    try {
      await fetchLogs({ cursor: nextCursor, append: true });
    } catch (err) {
      setError(err?.message || "Não foi possível carregar mais registros.");
    } finally {
      setLoadingMore(false);
    }
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setQuery(queryInput.trim());
  };

  const toggleExpanded = (id) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="logs-panel">
      <form className="logs-toolbar" onSubmit={submitSearch}>
        <select
          value={level}
          onChange={(event) => setLevel(event.target.value)}
          aria-label="Filtrar por nível"
        >
          <option value="">Todos os níveis</option>
          {LEVEL_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <select
          value={service}
          onChange={(event) => setService(event.target.value)}
          aria-label="Filtrar por serviço"
        >
          <option value="">Todos os serviços</option>
          <option value="api">api</option>
          <option value="storefront">storefront</option>
          <option value="worker">worker</option>
        </select>

        <input
          type="search"
          value={queryInput}
          onChange={(event) => setQueryInput(event.target.value)}
          placeholder="Buscar em evento/mensagem… (ex.: order.created)"
          aria-label="Buscar nos logs"
        />

        <button type="submit" className="button outline">
          Filtrar
        </button>

        <button
          type="button"
          className="button outline"
          onClick={() => setLive((value) => !value)}
          title="Atualiza a cada 3 segundos"
        >
          {live ? <Pause size={15} /> : <Play size={15} />}
          {live ? "Pausar" : "Ao vivo"}
        </button>

        <button
          type="button"
          className="button outline"
          onClick={reload}
          disabled={loading}
          title="Recarregar"
        >
          <RefreshCw size={15} />
        </button>
      </form>

      {traceId && (
        <div className="logs-trace-chip">
          <span>
            trace: <code>{traceId.slice(0, 13)}…</code>
          </span>
          <button type="button" onClick={() => setTraceId("")} aria-label="Limpar trace">
            <X size={14} />
          </button>
        </div>
      )}

      {error && <p className="logs-error">{error}</p>}

      {loading ? (
        <p className="management-loading">Carregando…</p>
      ) : entries.length === 0 ? (
        <p className="logs-empty">Nenhum registro encontrado.</p>
      ) : (
        <>
          <div className="logs-table" role="table" aria-label="Registros de log">
            {entries.map((entry) => {
              const isOpen = expanded.has(entry.id);
              const levelName = LEVEL_LABELS[entry.level] ?? String(entry.level);
              return (
                <div className="logs-row-wrapper" key={entry.id}>
                  <button
                    type="button"
                    className="logs-row"
                    onClick={() => toggleExpanded(entry.id)}
                  >
                    <span className="logs-ts">{formatTs(entry.ts)}</span>
                    <span className={`log-level ${levelName}`}>{levelName}</span>
                    <span className="logs-service">{entry.service}</span>
                    <span className="logs-message">
                      <b>{entry.event}</b> · {entry.message}
                    </span>
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  {isOpen && (
                    <div className="logs-detail">
                      <pre>
                        {JSON.stringify(
                          {
                            traceId: entry.traceId,
                            requestId: entry.requestId,
                            actorId: entry.actorId,
                            route: entry.route,
                            status: entry.status,
                            durationMs: entry.durationMs,
                            data: entry.data,
                            stack: entry.stack,
                          },
                          null,
                          2,
                        )}
                      </pre>
                      {entry.traceId && (
                        <button
                          type="button"
                          className="button outline"
                          onClick={() => setTraceId(entry.traceId)}
                        >
                          Ver trace completo
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {nextCursor && (
            <button
              type="button"
              className="button outline logs-more"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Carregando…" : "Carregar mais"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
