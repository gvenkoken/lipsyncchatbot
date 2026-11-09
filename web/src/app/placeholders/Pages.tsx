import type { ReactNode } from 'react';

function Placeholder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="page" aria-label={title}>
      <header className="page-heading"><p className="eyebrow">AVATAR ATÖLYESİ</p><h1>{title}</h1></header>
      <div className="card">
        <span className="badge">Hazırlık aşamasında</span>
        <h2>Çalışma alanı hazırlanıyor</h2>
        <p>{children}</p>
        <p className="muted">Bu ekran henüz yer tutucudur.</p>
      </div>
    </section>
  );
}

export function AvatarPlaceholder() {
  return <Placeholder title="Avatar deneme alanı">Dört avatarı aynı konuşma metni ve animasyon senaryolarıyla denemek için kullanılacak alan.</Placeholder>;
}
export function QualityPlaceholder() {
  return <Placeholder title="Kalite ve ortam kaydı">Gözlemsel değerlendirmeler ve tarayıcı ortamı burada kaydedilecek. Henüz değerlendirme yapılmadı.</Placeholder>;
}
export function VisualPlaceholder() {
  return <Placeholder title="Görsel ve kaynak incelemesi">Avatar kaynakları ve kaynaktan ayrı türev varlıklar burada incelenecek.</Placeholder>;
}
