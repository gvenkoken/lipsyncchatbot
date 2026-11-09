import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ActionButton, AtolyeGezinmesi, AvatarSelect, AvatarStage, Notice, ReviewItem, SourceCard, SpeechForm } from './index';

describe('Atölye bileşenleri', () => {
  it('gezinme mevcut rotaları ve etkin bağlantıyı gösterir', () => {
    render(<MemoryRouter initialEntries={['/kalite']}><AtolyeGezinmesi /></MemoryRouter>);
    expect(screen.getByRole('navigation', { name: 'Çalışma alanları' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kalite kaydı' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Deneme alanı' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Görsel inceleme' }).getAttribute('href')).toBe('/gorsel');
    fireEvent.click(screen.getByRole('link', { name: 'Görsel inceleme' }));
    expect(screen.getByRole('link', { name: 'Görsel inceleme' }).getAttribute('aria-current')).toBe('page');
  });

  it('yalnız verilen avatarları sıralar ve önizleme çizmez', () => {
    const change = vi.fn();
    const { container, rerender } = render(<AvatarSelect options={[4, 2, 1, 3]} value={1} onChange={change} />);
    expect(screen.getAllByRole('radio').map(input => input.getAttribute('value'))).toEqual(['1', '2', '3', '4']);
    for (const number of [1, 2, 3, 4]) expect(screen.getByLabelText(`Avatar ${number}`)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect((screen.getByRole('radio', { name: 'Avatar 1' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Avatar 3' }));
    expect(change).toHaveBeenCalledWith(3);
    rerender(<AvatarSelect options={[2, 4]} value={2} onChange={change} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByText('Avatar 1')).toBeNull();
  });

  it.each(['info', 'warning', 'error'] as const)('%s bildirimi başlık ve açıklama taşır', variant => {
    const retry = vi.fn();
    render(variant === 'error'
      ? <Notice variant="error" title="Yükleme başarısız" description="Varlık okunamadı." onRetry={retry} />
      : <Notice variant={variant} title="Ortam bilgisi" description="Ses ayarlarını inceleyin." />);
    const notice = screen.getByRole(variant === 'error' ? 'alert' : 'status');
    expect(notice.textContent).toContain(variant === 'error' ? 'Varlık okunamadı.' : 'Ses ayarlarını inceleyin.');
    expect(document.getElementById(notice.getAttribute('aria-labelledby')!)?.textContent).toBe(variant === 'error' ? 'Yükleme başarısız' : 'Ortam bilgisi');
    if (variant === 'error') {
      fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
      expect(retry).toHaveBeenCalledTimes(1);
    } else expect(screen.queryByRole('button')).toBeNull();
  });

  it('devre dışı eylemin nedenini yanında açıklar ve çalıştırmaz', () => {
    const click = vi.fn();
    const { rerender } = render(<ActionButton disabled disabledReason="Avatar yükleniyor." onClick={click}>Konuş</ActionButton>);
    const button = screen.getByRole('button', { name: 'Konuş' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Avatar yükleniyor.');
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    rerender(<ActionButton onClick={click}>Konuş</ActionButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Konuş' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Avatar yükleniyor.')).toBeNull();
  });

  it.each(['primary', 'secondary', 'stop', 'icon', 'launcher'] as const)('%s düğmesi ad ve tıklama sağlar', variant => {
    const click = vi.fn();
    render(<ActionButton variant={variant} aria-label="Paneli aç" onClick={click}>＋</ActionButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Paneli aç' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('durum ve FPS tuvalden ayrıdır; FPS kapatılabilir', () => {
    const ref = createRef<HTMLCanvasElement>();
    const { rerender } = render(<AvatarStage ref={ref} avatar={1} state="thinking" showFps fps={60} />);
    expect(screen.getByRole('status').textContent).toBe('Düşünme');
    expect(screen.getByText('60 FPS')).toBeTruthy();
    expect(ref.current).toBeTruthy();
    expect(ref.current?.contains(screen.getByText('60 FPS'))).toBe(false);
    expect(ref.current?.contains(screen.getByRole('status'))).toBe(false);
    rerender(<AvatarStage avatar={2} state="idle" fps={60} />);
    expect(screen.queryByText('60 FPS')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Bekleme');
    rerender(<AvatarStage avatar={2} state="loading" showFps />);
    expect(screen.getByText('Kare hızı henüz ölçülmedi')).toBeTruthy();
    expect(screen.getByText('Avatar yükleniyor...')).toBeTruthy();
  });

  it('metin, ses, hız ve perde değişikliklerini üst bileşene iletir', () => {
    const change = vi.fn();
    const value = { text: 'Merhaba', voice: 'tr', rate: 1, pitch: 1 };
    render(<SpeechForm value={value} voices={[{ id: 'tr', label: 'Türkçe' }, { id: 'tr2', label: 'Türkçe 2' }]} onChange={change} />);
    fireEvent.change(screen.getByLabelText(/Seslendirilecek metin/), { target: { value: '<b>Merhaba</b>' } });
    expect(change).toHaveBeenLastCalledWith({ ...value, text: '<b>Merhaba</b>' });
    fireEvent.change(screen.getByLabelText('Türkçe ses'), { target: { value: 'tr2' } });
    expect(change).toHaveBeenLastCalledWith({ ...value, voice: 'tr2' });
    fireEvent.change(screen.getByLabelText('Hız'), { target: { value: '1.2' } });
    expect(change).toHaveBeenLastCalledWith({ ...value, rate: 1.2 });
    fireEvent.change(screen.getByLabelText('Perde'), { target: { value: '0.8' } });
    expect(change).toHaveBeenLastCalledWith({ ...value, pitch: 0.8 });
    expect(screen.getByText('Ses ayarları').closest('details')).toBeTruthy();
  });

  it('ses yokluğunu açıklar', () => {
    render(<SpeechForm value={{ text: '', voice: '', rate: 1, pitch: 1 }} voices={[]} onChange={vi.fn()} />);
    expect((screen.getByLabelText('Türkçe ses') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Bekleme ve düşünme animasyonlarını deneyebilirsiniz/)).toBeTruthy();
  });

  it('değerlendirme tarafsız başlar ve not değişikliklerini iletir', () => {
    const change = vi.fn();
    render(<ReviewItem title="Ses ve ağız uyumu" description="Geçişleri izleyin." onChange={change} />);
    expect((screen.getByLabelText('Gözlem') as HTMLSelectElement).value).toBe('unreviewed');
    expect(screen.getByRole('option', { name: 'Değerlendirilmedi' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Gözlem'), { target: { value: 'defect' } });
    expect(change).toHaveBeenLastCalledWith('defect', '');
    fireEvent.change(screen.getByLabelText('Kusur veya gözlem notu'), { target: { value: 'Geçiş sert.' } });
    expect(change).toHaveBeenLastCalledWith('unreviewed', 'Geçiş sert.');
  });

  it('kaynak yolunu, ilişkisini ve eksik bilgisini düz metin gösterir', () => {
    const text = '<b>kaynak</b>';
    const { container } = render(<SourceCard title="Avatar 1" path="assets/owner/konusan-avatar-katman-varlik-seti-1.png" relationship={text} missingNote="Türev henüz eklenmedi." />);
    expect(screen.getByText('assets/owner/konusan-avatar-katman-varlik-seti-1.png')).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText('Türev henüz eklenmedi.')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
  });
});
