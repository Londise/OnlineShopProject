// Render allows 30 seconds by default. Leave headroom for process termination.
export function createShutdown({ server, flush, disconnect, onStart = () => {}, exit = code => process.exit(code), timeoutMs = 25_000 }) {
  let pending;
  return signal => {
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      let timer;
      try {
        onStart(signal);
        const cleanup = async () => {
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          await flush();
          await disconnect();
        };
        await Promise.race([
          cleanup(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('SHUTDOWN_TIMEOUT')), timeoutMs);
          }),
        ]);
        exit(0);
      } catch {
        // Never print a connection error (it may contain credentials).
        console.error(JSON.stringify({ level: 50, event: 'api.shutdown_failed', message: 'Encerramento incompleto; consulte a saúde das dependências.' }));
        server.closeAllConnections?.();
        exit(1);
      } finally {
        clearTimeout(timer);
      }
    });
    return pending;
  };
}
