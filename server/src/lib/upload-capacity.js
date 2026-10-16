// Bound the whole upload (multipart buffer + decode + Storage write), not just
// the compressed file size. A slot remains held if the client disconnects while
// decoding/writing, until the handler actually completes.
export function createUploadCapacity(limit = 1) {
  let active = 0;
  return {
    acquire() {
      if (active >= limit) return null;
      active++;
      let released = false;
      return () => {
        if (!released) { released = true; active--; }
      };
    },
    active: () => active,
  };
}
