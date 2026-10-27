import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const documentUrl = new URL("../docs/documentacion.html", import.meta.url);

test("documentation is a single offline HTML with valid navigation targets", async () => {
  const files = await readdir(new URL("../docs/", import.meta.url));
  assert.deepEqual(files.filter(file => /\.(?:md|html)$/i.test(file)), ["documentacion.html"]);
  const html = await readFile(documentUrl, "utf8");
  assert.match(html, /<nav\b/i);
  assert.match(html, /lang="es"/);
  assert.doesNotMatch(html, /<script\b|<link\b[^>]*href="https?:/i);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "duplicate anchors");
  for (const [, href] of html.matchAll(/\bhref="([^"]+)"/g)) {
    if (href.startsWith("#")) assert.ok(ids.includes(href.slice(1)), `missing anchor: ${href}`);
    else if (!/^[a-z]+:/i.test(href)) await access(new URL(href.split("#")[0], documentUrl));
  }
});
