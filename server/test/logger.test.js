import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

// Variáveis precisam existir antes de importar o logger (env.js valida na carga).
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/logs_test?schema=app";
process.env.LOG_LEVEL = "trace";
process.env.LOG_DEBUG_SAMPLE = "1";
process.env.LOG_BUFFER_MAX = "100";
process.env.LOG_FLUSH_MS = "250";

const {
  __testing,
  flush,
  log,
  passesFilters,
  redactData,
  redactValue,
} = await import("../src/lib/logger.js");
const { runWithTrace } = await import("../src/lib/trace-context.js");

beforeEach(() => {
  __testing.buffer.length = 0;
});

test("redactData redige e-mail, CPF, cartão e chaves sensíveis aninhadas", () => {
  const output = redactData({
    email: "cliente@exemplo.com",
    note: "CPF 123.456.789-00 e cartão 4111 1111 1111 1111",
    password: "segredo",
    nested: { authorization: "Bearer abc", items: [{ token: "x" }] },
    plain: "texto comum",
  });
  assert.equal(output.email, "[REDACTED]");
  assert.equal(output.note, "CPF [REDACTED] e cartão [REDACTED]");
  assert.equal(output.password, "[REDACTED]");
  assert.equal(output.nested.authorization, "[REDACTED]");
  assert.equal(output.nested.items[0].token, "[REDACTED]");
  assert.equal(output.plain, "texto comum");
});

test("redactValue limita a profundidade para evitar estruturas gigantes", () => {
  const deep = {};
  let current = deep;
  for (let i = 0; i < 12; i += 1) {
    current.next = {};
    current = current.next;
  }
  let output = redactValue(deep);
  for (let i = 0; i < 6; i += 1) output = output.next;
  assert.equal(output, "[Truncated]");
});

test("passesFilters aplica nível mínimo e sampling apenas em debug", () => {
  assert.equal(passesFilters(20, { minLevel: 30, sample: 0 }), false);
  assert.equal(passesFilters(30, { minLevel: 30, sample: 0 }), true);
  assert.equal(passesFilters(50, { minLevel: 30, sample: 0 }), true);
  assert.equal(passesFilters(20, { minLevel: 10, sample: 1 }), true);
  assert.equal(passesFilters(20, { minLevel: 10, sample: 0.5 }, () => 0.9), false);
});

test("log empilha entrada redigida e flush envia o lote ao destino", async () => {
  const batches = [];
  __testing.setSink(async (entries) => batches.push(entries));
  try {
    log("info", "order.created", "Pedido FM-1 criado", {
      actorId: "user-1",
      data: { email: "a@b.com" },
    });
    assert.equal(__testing.buffer.length, 1);
    await flush();
    assert.equal(__testing.buffer.length, 0);
    assert.equal(batches.length, 1);
    const [entry] = batches[0];
    assert.equal(entry.level, 30);
    assert.equal(entry.event, "order.created");
    assert.equal(entry.actorId, "user-1");
    assert.equal(entry.data.email, "[REDACTED]");
    assert.ok(entry.ts instanceof Date);
  } finally {
    __testing.resetSink();
  }
});

test("atingir o limite do buffer dispara flush automático", async () => {
  const batches = [];
  __testing.setSink(async (entries) => batches.push(entries));
  const previous = __testing.config.bufferMax;
  __testing.config.bufferMax = 3;
  try {
    log("info", "test.event", "1");
    log("info", "test.event", "2");
    log("info", "test.event", "3");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(batches.flat().length, 3);
    assert.equal(__testing.buffer.length, 0);
  } finally {
    __testing.config.bufferMax = previous;
    __testing.resetSink();
  }
});

test("falha no flush desvia o lote para a dead-letter sem lançar erro", async () => {
  const dead = [];
  __testing.setSink(async () => {
    throw new Error("db down");
  });
  __testing.setDeadSink(async (entries, reason) => dead.push({ entries, reason }));
  try {
    log("error", "db.query_timeout", "timeout");
    await flush();
    assert.equal(dead.length, 1);
    assert.equal(dead[0].reason, "db down");
    assert.equal(dead[0].entries[0].event, "db.query_timeout");
    assert.equal(__testing.buffer.length, 0);
  } finally {
    __testing.resetSink();
    __testing.resetDeadSink();
  }
});

test("log herda traceId e requestId do contexto da request", async () => {
  const batches = [];
  __testing.setSink(async (entries) => batches.push(entries));
  try {
    runWithTrace(
      {
        traceId: "11111111-2222-3333-4444-555555555555",
        requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        service: "api",
      },
      () => log("info", "http.request", "GET /x 200 · 5ms"),
    );
    await flush();
    assert.equal(batches[0][0].traceId, "11111111-2222-3333-4444-555555555555");
    assert.equal(batches[0][0].requestId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  } finally {
    __testing.resetSink();
  }
});
