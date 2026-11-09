import { Route, Routes } from 'react-router-dom';
import { Layout } from './app/Layout';
import { AvatarPlaceholder, QualityPlaceholder, VisualPlaceholder } from './app/placeholders/Pages';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AvatarPlaceholder />} />
        <Route path="kalite" element={<QualityPlaceholder />} />
        <Route path="gorsel" element={<VisualPlaceholder />} />
        <Route path="*" element={<section className="page"><h1>Sayfa bulunamadı</h1><p>Menüden bir çalışma alanı seçin.</p></section>} />
      </Route>
    </Routes>
  );
}
