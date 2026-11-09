import { NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="shell">
      <a className="skip-link" href="#icerik">İçeriğe geç</a>
      <header className="navigation">
        <div className="brand">Avatar Atölyesi<span>Sakin odak</span></div>
        <nav aria-label="Çalışma alanları">
          <NavLink to="/" end>Avatar deneme alanı</NavLink>
          <NavLink to="/kalite">Kalite ve ortam kaydı</NavLink>
          <NavLink to="/gorsel">Görsel ve kaynak incelemesi</NavLink>
        </nav>
      </header>
      <main id="icerik"><Outlet /></main>
      <footer>Avatar Atölyesi · Son kalite kararı insan değerlendirmesine aittir.</footer>
    </div>
  );
}
