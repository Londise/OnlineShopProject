import { screen, within } from '@testing-library/react';

// O mesmo produto aparece em Destaques e no catálogo. Escolha o cartão do
// catálogo pelo nome, sem depender da posição ou da quantidade de destaques.
export function catalogCard(name) {
  const catalog = within(screen.getByRole('heading', { name: 'Monte seu pedido.', exact: true }).closest('section'));
  return within(catalog.getByRole('heading', { name, exact: true }).closest('article'));
}

export const mediaUpload = () => within(screen.getByRole('region', { name: 'Enviar imagem', exact: true }));
export const mediaLibrary = () => within(screen.getByRole('region', { name: 'Biblioteca de imagens', exact: true }));
