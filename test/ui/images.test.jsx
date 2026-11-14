import React from 'react';
import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ResponsiveImage from '../../src/components/ResponsiveImage';
import HeroImage from '../../src/components/HeroImage';

const src = 'https://images-test.supabase.co/storage/v1/object/public/storefront-images/a.jpg';

test('I3: a failed transform falls back once to the original and a new source can optimize again', () => {
  const onFinalError = vi.fn();
  const view = render(<ResponsiveImage src={src} alt="Calça" sourceWidth={600} sourceHeight={900} onFinalError={onFinalError} />);
  const image = screen.getByRole('img', { name: 'Calça' });
  expect(image.src).toContain('/render/image/public/');
  expect(image).toHaveAttribute('srcset');
  fireEvent.error(image);
  expect(image.src).toBe(src);
  expect(image).not.toHaveAttribute('srcset');
  expect(onFinalError).not.toHaveBeenCalled();
  fireEvent.error(image);
  expect(onFinalError).toHaveBeenCalledTimes(1);
  view.rerender(<ResponsiveImage src={src.replace('a.jpg', 'b.jpg')} alt="Calça" sourceWidth={600} sourceHeight={900} />);
  expect(image.src).toContain('/render/image/public/');
  expect(image).toHaveAttribute('srcset');
});

test('I3/V3: final hero image failure releases the storefront loading gate', () => {
  const ready = vi.fn();
  render(<HeroImage src={src} alt="Banner" sourceWidth={1200} sourceHeight={600} onSettled={ready} />);
  const image = screen.getByRole('img', { name: 'Banner' });
  fireEvent.error(image);
  expect(ready).not.toHaveBeenCalled();
  fireEvent.error(image);
  expect(ready).toHaveBeenCalledTimes(1);
});
