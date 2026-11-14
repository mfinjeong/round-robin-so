// Scaffold entry (ADR-001). frontend-engineer replaces body with src/ui App.
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Elemen root tidak tersedia');
createRoot(root).render(
  <main>
    <h1>Gilir</h1>
    <p>Simulasi router Round Robin. Tidak memanggil penyedia AI mana pun dan tidak meminta kunci API.</p>
  </main>,
);
