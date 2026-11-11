import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('Home replaces the technical notice and never uses the unavailable-image SVG for its hero', async () => {
  const home = await readFile(new URL('../src/pages/Home.jsx', import.meta.url), 'utf8');
  assert.ok(!home.includes('Carregando catálogo…'));
  assert.ok(!home.includes('O servidor pode levar alguns instantes para iniciar.'));
  assert.ok(!home.includes('IMAGE_PLACEHOLDER'));
  assert.match(home, /initialLoading && <StorefrontLoading/);
  assert.match(home, /inert=\{initialLoading/);
  assert.match(home, /index === activeSlide && item\.imageUrl/);
  assert.match(home, /!catalogLoading && !catalogError && !displayed\.length/);
});

test('the loading screen renders accessible branding without technical messages or image dependencies', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const { default: Loading } = await vite.ssrLoadModule('/src/components/StorefrontLoading.jsx');
    const html = renderToStaticMarkup(React.createElement(Loading));
    assert.match(html, /role="status"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /Preparando a loja/);
    assert.match(html, /Ferchu/);
    assert.doesNotMatch(html, /<img|servidor|indisponível|%/);
  } finally {
    await vite.close();
  }
});

test('the hero starts invisible over a wine background and respects reduced motion', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.hero-slide\s*\{[^}]*background:\s*#65243f/s);
  assert.match(css, /\.hero-slide-media\s*\{[^}]*opacity:\s*0/s);
  assert.match(css, /\.hero-slide-media\.is-loaded\s*\{\s*opacity:\s*1/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.storefront-loading-flower/);
});
