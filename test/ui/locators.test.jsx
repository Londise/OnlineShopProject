import React from 'react';
import { test, expect } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { catalogCard, mediaUpload, mediaLibrary } from '../support/locators';

const card = (name, key = name) => <article key={key}><h3>{name}</h3><button>Montar pedido</button></article>;

test('locator contract: catalog product identity survives reordered cards and duplicate highlights', async () => {
  const clicked = [];
  render(<>
    <section><h2>Destaques</h2>{card('Calça Linho')}</section>
    <section><h2>Monte seu pedido.</h2>
      {card('Vestido')}
      <article><h3>Calça Linho</h3><button onClick={() => clicked.push('catalog')}>Montar pedido</button></article>
    </section>
  </>);
  await userEvent.click(catalogCard('Calça Linho').getByRole('button', { name: 'Montar pedido', exact: true }));
  expect(clicked).toEqual(['catalog']);
});

test('locator contract: duplicate product identities in the same catalog fail instead of selecting the first', () => {
  render(<section><h2>Monte seu pedido.</h2>{card('Calça Linho')}{card('Calça Linho', 'duplicate')}</section>);
  expect(() => catalogCard('Calça Linho')).toThrow(/Found multiple elements/);
});

test('locator contract: upload fields do not collide with library search or another form', async () => {
  render(<>
    <section aria-label="Outra edição"><label>Descrição<input /></label></section>
    <section aria-label="Enviar imagem"><label>Descrição<input /></label><input type="file" aria-label="Escolher arquivo" /></section>
    <section aria-label="Biblioteca de imagens"><input type="search" aria-label="Buscar por descrição" /></section>
  </>);
  const description = mediaUpload().getByRole('textbox', { name: 'Descrição', exact: true });
  await userEvent.type(description, 'Nova capa');
  expect(description).toHaveValue('Nova capa');
  expect(mediaLibrary().getByRole('searchbox', { name: 'Buscar por descrição', exact: true })).toHaveValue('');
  expect(mediaUpload().getByLabelText('Escolher arquivo', { exact: true })).toHaveAttribute('type', 'file');
});
