import React from 'react';
import { expect, test, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LogsPanel from '../../src/components/LogsPanel';
import { deferred, json, respond, requests } from '../support/network';
import { logEntry } from '../support/fixtures';

test('G9: late results from an abandoned filter cannot replace the current logs', async () => {
  const old = deferred();
  respond('GET', '/api/v1/admin/logs', ({ url }) => url.searchParams.get('level') === 'error'
    ? json({ entries: [logEntry('new', 'Current error', { level: 50 })], nextCursor: null }) : old.promise);
  render(<LogsPanel />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por nível' }), 'error');
  expect(await screen.findByText(/Current error/)).toBeVisible();
  await act(async () => old.resolve(json({ entries: [logEntry('old', 'Obsolete info')], nextCursor: 'old-cursor' })));
  expect(screen.getByText(/Current error/)).toBeVisible();
  expect(screen.queryByText(/Obsolete info/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
});

test('G9: pagination from an abandoned query cannot append entries to a new filter', async () => {
  const page = deferred();
  respond('GET', '/api/v1/admin/logs', ({ url }) => {
    if (url.searchParams.has('cursor')) return page.promise;
    return json({ entries: [logEntry('1', url.searchParams.get('service') || 'Initial')], nextCursor: 'page-2' });
  });
  render(<LogsPanel />);
  await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por serviço' }), 'worker');
  await screen.findByText(/order.created/);
  await act(async () => page.resolve(json({ entries: [logEntry('2', 'Abandoned page')], nextCursor: null })));
  expect(screen.queryByText(/Abandoned page/)).not.toBeInTheDocument();
});

test('G8: search, trace drilldown and pagination send the visible filter contract', async () => {
  const traceId = 'ac6eb1a3-4e6f-4000-9000-cada5983d31c';
  respond('GET', '/api/v1/admin/logs', ({ url }) => json({
    entries: [logEntry(url.searchParams.has('cursor') ? '2' : '1', 'Pedido recebido', { traceId })],
    nextCursor: url.searchParams.has('cursor') ? null : 'page-2',
  }));
  render(<LogsPanel />);
  await userEvent.type(screen.getByRole('searchbox'), '  order.created  ');
  await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
  await userEvent.click(await screen.findByRole('button', { name: /Pedido recebido/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Ver trace completo' }));
  await waitFor(() => expect(requests.at(-1).url.searchParams.get('traceId')).toBe(traceId));
  await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: /Pedido recebido/ })).toHaveLength(2));
  expect(Object.fromEntries(requests.at(-1).url.searchParams)).toEqual({ limit: '60', q: 'order.created', traceId, cursor: 'page-2' });
  await userEvent.click(screen.getByRole('button', { name: 'Limpar trace' }));
  await waitFor(() => expect(requests.at(-1).url.searchParams.has('traceId')).toBe(false));
});

test('G9: overlapping log pages do not duplicate an existing row', async () => {
  respond('GET', '/api/v1/admin/logs', ({ url }) => json(url.searchParams.has('cursor')
    ? { entries: [logEntry('2', 'Second'), logEntry('3', 'Third')], nextCursor: null }
    : { entries: [logEntry('1', 'First'), logEntry('2', 'Second')], nextCursor: 'page-2' }));
  render(<LogsPanel />);
  await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
  expect(await screen.findByText(/Third/)).toBeVisible();
  expect(screen.getAllByText(/Second/)).toHaveLength(1);
});

test('G8: a pending live refresh keeps current entries visible; pausing and unmount stop polling', async () => {
  vi.useFakeTimers();
  const pending = deferred(); let calls = 0;
  respond('GET', '/api/v1/admin/logs', () => ++calls === 1
    ? json({ entries: [logEntry('1', 'Current row')], nextCursor: null }) : pending.promise);
  const view = render(<LogsPanel />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Ao vivo' }));
  await act(async () => vi.advanceTimersByTime(3000));
  expect(screen.getByText(/Current row/)).toBeVisible();
  await act(async () => vi.advanceTimersByTime(6000));
  expect(calls).toBe(2); // A slow backend must not accumulate concurrent polls.
  fireEvent.click(screen.getByRole('button', { name: 'Pausar' }));
  await act(async () => pending.resolve(json({ entries: [logEntry('2', 'Updated row')], nextCursor: null })));
  await act(async () => vi.advanceTimersByTime(6000));
  expect(calls).toBe(2);
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('G8: a visible query error is recoverable by reloading the current filters', async () => {
  respond('GET', '/api/v1/admin/logs', () => json({ error: { message: 'Logs unavailable' } }, 409));
  render(<LogsPanel />);
  expect(await screen.findByText('Logs unavailable')).toBeVisible();
  respond('GET', '/api/v1/admin/logs', { entries: [logEntry('recovered', 'Recovered log')], nextCursor: null });
  await userEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
  expect(await screen.findByText(/Recovered log/)).toBeVisible();
  expect(screen.queryByText('Logs unavailable')).not.toBeInTheDocument();
});

test('G9: a live first page invalidates an older pending page without duplicate or abandoned rows', async () => {
  vi.useFakeTimers();
  const page = deferred(); let firstPages = 0;
  respond('GET', '/api/v1/admin/logs', ({ url }) => url.searchParams.has('cursor') ? page.promise : json({
    entries: ++firstPages === 1 ? [logEntry('1', 'Initial row')] : [logEntry('2', 'Current row'), logEntry('3', 'Latest row')], nextCursor: 'next',
  }));
  render(<LogsPanel />); await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ao vivo' }));
  await act(async () => vi.advanceTimersByTime(3000));
  await act(async () => page.resolve(json({ entries: [logEntry('2', 'Current row'), logEntry('4', 'Abandoned row')], nextCursor: null })));
  expect(screen.getAllByText(/Current row/)).toHaveLength(1);
  expect(screen.getByText(/Latest row/)).toBeVisible();
  expect(screen.queryByText(/Abandoned row/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeEnabled();
});
