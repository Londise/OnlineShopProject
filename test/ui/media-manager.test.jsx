import React from 'react';
import { expect, test } from 'vitest';
import { screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Management from '../../src/pages/Management';
import { renderPage } from '../support/render';
import { respond, requests, json } from '../support/network';
import { admin, catalogProduct } from '../support/fixtures';

const mutations = () => requests.filter(request => request.method !== 'GET');
const mediaRequests = () => requests.filter(request => request.method === 'GET' && request.url.pathname === '/api/v1/admin/media-assets');
const asset = (overrides = {}) => ({ id: 'asset-1', url: '/photo.png', altText: 'Nova capa', purpose: 'library', width: 600, height: 400, byteSize: 120_000, productImages: [], ...overrides });

async function openMedia(assets = [], total = assets.length) {
  respond('GET', '/api/v1/auth/me', { user: admin });
  respond('GET', '/api/v1/admin/orders', { orders: [] });
  respond('GET', '/api/v1/admin/media-assets', request => {
    const offset = Number(request.url.searchParams.get('offset') ?? 0);
    const limit = Number(request.url.searchParams.get('limit') ?? 24);
    return json({ assets: assets.slice(offset, offset + limit), total });
  });
  respond('GET', '/api/v1/admin/products', { products: [catalogProduct()] });
  respond('GET', '/api/v1/admin/catalog-metadata', { categories: [catalogProduct().category], sizes: [], variantOptions: [] });
  respond('GET', '/api/v1/admin/banners', { banners: [{ id: 'banner-1', title: 'Novidades', active: true, sortOrder: 0 }] });
  renderPage(<Management />, { waitForSession: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Imagens', exact: true }));
  await screen.findByRole('option', { name: 'Calça Linho' });
  await waitFor(() => expect(screen.queryByText('Carregando…')).not.toBeInTheDocument());
}

test('G7: changing destination clears the incompatible product and option selections', async () => {
  await openMedia();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Selecione', exact: true }), 'product-1');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /Cor ou estampa/ }), 'option-1');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Destino', exact: true }), 'category');
  expect(screen.getByRole('combobox', { name: 'Selecione', exact: true })).toHaveValue('');
  expect(screen.queryByRole('combobox', { name: /Cor ou estampa/ })).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Destino', exact: true }), 'product');
  expect(screen.getByRole('combobox', { name: 'Selecione', exact: true })).toHaveValue('');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Selecione', exact: true }), 'product-1');
  expect(screen.getByRole('combobox', { name: /Cor ou estampa/ })).toHaveValue('');
});

test('G7: cover and order edits send their own patch and display the refreshed association', async () => {
  const associated = asset({ purpose: 'product', productImages: [{ id: 'image-1', product: { name: 'Calça Linho' }, type: 'SECONDARY', sortOrder: 2 }] });
  await openMedia([associated]);
  respond('PATCH', '/api/v1/admin/product-images/image-1', { image: { id: 'image-1', type: 'PRIMARY', sortOrder: 2 } });
  respond('GET', '/api/v1/admin/media-assets', () => json({ assets: [{ ...associated, productImages: [{ ...associated.productImages[0], type: 'PRIMARY' }] }], total: 1 }));
  await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Usar como capa — Calça Linho' }));
  expect(await screen.findByRole('button', { name: 'Capa atual — Calça Linho' })).toBeDisabled();
  expect(JSON.parse(mutations()[0].body)).toEqual({ primary: true });
  const order = within(screen.getByRole('article')).getByRole('spinbutton', { name: 'Ordem da foto de Calça Linho' });
  await userEvent.clear(order);
  await userEvent.type(order, '0');
  await userEvent.tab();
  await waitFor(() => expect(mutations()).toHaveLength(2));
  expect(JSON.parse(mutations()[1].body)).toEqual({ sortOrder: 0 });
});

test('G7: rejected cover edits preserve the association and allow retry', async () => {
  const associated = asset({ productImages: [{ id: 'image-1', product: { name: 'Calça Linho' }, type: 'SECONDARY', sortOrder: 2 }] });
  await openMedia([associated]);
  respond('PATCH', '/api/v1/admin/product-images/image-1', () => json({ error: { message: 'Conflito de capa' } }, 409));
  await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Usar como capa — Calça Linho' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Conflito de capa');
  expect(within(screen.getByRole('article')).getByRole('button', { name: 'Usar como capa — Calça Linho' })).toBeEnabled();
});

test('G8: the library paginates with "carregar mais" and reports the real total', async () => {
  const assets = Array.from({ length: 30 }, (_, index) => asset({ id: `asset-${index}`, altText: `Foto ${index}` }));
  await openMedia(assets, 30);
  expect((await screen.findAllByRole('article')).length).toBe(24);
  expect(screen.getByText('30 imagens')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
  expect((await screen.findAllByRole('article')).length).toBe(30);
  const last = mediaRequests().at(-1);
  expect(last.url.searchParams.get('offset')).toBe('24');
});

test('G8: destination filter and description search reload the first page with their parameters', async () => {
  await openMedia([asset()], 1);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por destino' }), 'product');
  await waitFor(() => expect(mediaRequests().some(request => request.url.searchParams.get('purpose') === 'product')).toBe(true));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar por descrição' }), 'Nova');
  await waitFor(() => expect(mediaRequests().some(request => request.url.searchParams.get('q') === 'Nova')).toBe(true));
});

test('G8: unreferenced images are deleted after confirmation and the list updates', async () => {
  await openMedia([asset()], 1);
  respond('DELETE', '/api/v1/admin/media-assets/asset-1', () => new Response(null, { status: 204 }));
  await userEvent.click(screen.getByRole('button', { name: 'Excluir imagem Nova capa' }));
  expect(screen.getByText('Excluir definitivamente?')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));
  expect(await screen.findByText('Imagem excluída.')).toBeVisible();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(requests.some(request => request.method === 'DELETE' && request.url.pathname === '/api/v1/admin/media-assets/asset-1')).toBe(true);
});

test('G8: images linked to products show "Em uso" and cannot be deleted', async () => {
  const referenced = asset({ productImages: [{ id: 'image-1', product: { name: 'Calça Linho' }, type: 'PRIMARY', sortOrder: 0 }] });
  await openMedia([referenced], 1);
  expect(screen.getByRole('button', { name: 'Excluir imagem Nova capa' })).toBeDisabled();
  expect(screen.getByText('Em uso')).toBeVisible();
});

test('G8: deletion conflicts keep the image and expose the server message', async () => {
  await openMedia([asset()], 1);
  respond('DELETE', '/api/v1/admin/media-assets/asset-1', () => json({ error: { code: 'MEDIA_IN_USE', message: 'Esta imagem está em uso (produto, categoria, banner ou pedido) e não pode ser excluída.' } }, 409));
  await userEvent.click(screen.getByRole('button', { name: 'Excluir imagem Nova capa' }));
  await userEvent.click(screen.getByRole('button', { name: 'Sim, excluir' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Esta imagem está em uso');
  expect(screen.getByRole('article')).toBeVisible();
});

test('G8: invalid local files are refused before any upload request', async () => {
  await openMedia();
  const file = new File(['plain text'], 'photo.txt', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('Escolher arquivo'), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('JPEG, PNG ou WebP de até 5 MB');
  expect(mutations().length).toBe(0);
});
