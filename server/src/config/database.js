import { z } from "zod";

// Return only configuration guidance, never the URL (which contains a password).
export const databaseUrlSchema = z.string().superRefine((value, ctx) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Informe uma URL PostgreSQL válida." });
    return;
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    ctx.addIssue({ code: "custom", message: "O backend agora usa PostgreSQL, não MySQL." });
  }
  if (!url.hostname || url.pathname.length < 2) {
    ctx.addIssue({ code: "custom", message: "A conexão precisa informar servidor e banco." });
  }
  if (url.searchParams.get("schema") !== "app") {
    ctx.addIssue({ code: "custom", message: "Adicione schema=app à conexão PostgreSQL." });
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && url.searchParams.get("sslmode") !== "require") {
    ctx.addIssue({ code: "custom", message: "Use sslmode=require para a conexão remota." });
  }
});
