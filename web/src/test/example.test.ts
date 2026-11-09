import { expect, it } from 'vitest';

it('Vitest örneği ağ veya saat gerektirmeden çalışır', () => {
  expect(['Avatar 1', 'Avatar 2', 'Avatar 3', 'Avatar 4']).toHaveLength(4);
});
