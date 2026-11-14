import React from 'react';
import { expect, test } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Management from '../../src/pages/Management';
import { renderPage } from '../support/render';
import { respond, requests, json } from '../support/network';
import { admin, catalogProduct } from '../support/fixtures';

const mutations = () => requests.filter(request => request.method !== 'GET');
const asset = { id: 'asset-1', url: '/new-cover.png', altText: 'Nova capa', purpose: 'product', productImages: [] };
async function openMedia(assets = []) {
  respond('GET', '/api/v1/auth/me', { user: admin });
  respond('GET', '/api/v1/admin/orders', { orders: [] });
  respond('GET', '/api/v1/admin/media-assets', { assets });
  respond('GET', '/api/v1/admin/products', { products: [catalogProduct()] });
  respond('GET', '/api/v1/admin/catalog-metadata', { categories: [catalogProduct().category], sizes: [], variantOptions: [] });
  respond('GET', '/api/v1/admin/banners', { banners: [{ id: 'banner-1', title: 'Novidades', active: true, sortOrder: 0 }] });
  renderPage(<Management />, { waitForSession: true });
  await userEvent.click(await screen.findByRole('button', { name: 'Imagens', exact: true }));
  await screen.findByRole('option', { name: 'Calça Linho' });
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
  const associated = { ...asset, productImages: [{ id: 'image-1', product: { name: 'Calça Linho' }, type: 'SECONDARY', sortOrder: 2 }] };
  await openMedia([associated]);
  respond('PATCH', '/api/v1/admin/product-images/image-1', { image: { id: 'image-1', type: 'PRIMARY', sortOrder: 2 } });
  respond('GET', '/api/v1/admin/media-assets', { assets: [{ ...associated, productImages: [{ ...associated.productImages[0], type: 'PRIMARY' }] }] });
  await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Usar como capa' }));
  expect(await screen.findByRole('button', { name: 'Capa atual' })).toBeDisabled();
  expect(JSON.parse(mutations()[0].body)).toEqual({ primary: true });
  const order = within(screen.getByRole('article')).getByRole('spinbutton', { name: 'Ordem' });
  await userEvent.clear(order);
  await userEvent.type(order, '0');
  await userEvent.tab();
  await waitFor(() => expect(mutations()).toHaveLength(2));
  expect(JSON.parse(mutations()[1].body)).toEqual({ sortOrder: 0 });
});

test('G7: rejected cover edits preserve the association and allow retry', async () => {
  const associated = { ...asset, productImages: [{ id: 'image-1', product: { name: 'Calça Linho' }, type: 'SECONDARY', sortOrder: 2 }] };
  await openMedia([associated]);
  respond('PATCH', '/api/v1/admin/product-images/image-1', () => json({ error: { message: 'Conflito de capa' } }, 409));
  await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: 'Usar como capa' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Conflito de capa');
  expect(within(screen.getByRole('article')).getByRole('button', { name: 'Usar como capa' })).toBeEnabled();
  expect(requests.filter(request => request.url.pathname === '/api/v1/admin/media-assets')).toHaveLength(1);
});
