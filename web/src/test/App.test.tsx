import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../App';

const pages = [
  ['/', 'Avatar deneme alanı'],
  ['/kalite', 'Kalite ve ortam kaydı'],
  ['/gorsel', 'Görsel ve kaynak incelemesi'],
] as const;

describe('Çalışma alanları', () => {
  it.each(pages)('%s doğrudan açılır', (path, title) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole('link', { name: title }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('Bu ekran henüz yer tutucudur.')).toBeTruthy();
  });

  it('menü bağlantıları üç ekranı da açar', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    for (const [path, title] of [...pages.slice(1), pages[0]]) {
      const link = screen.getByRole('link', { name: title });
      expect(link.getAttribute('href')).toBe(path);
      fireEvent.click(link);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect(link.getAttribute('aria-current')).toBe('page');
    }
  });

  it('bilinmeyen rota gezinmeyi korur', () => {
    render(<MemoryRouter initialEntries={['/bilinmeyen']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Sayfa bulunamadı' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Çalışma alanları' })).toBeTruthy();
  });
});
