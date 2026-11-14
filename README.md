# Gilir

Game simulasi router Round Robin di peramban. **Simulasi saja**: tidak memanggil penyedia AI mana pun, tidak meminta kunci API, tidak meneruskan permintaan nyata. Nama penyedia/akun fiktif; tidak berafiliasi dengan produk gateway mana pun.

Status: F0 fondasi. Engine, UI, dan level belum ada.

## Menjalankan

```sh
npm ci --ignore-scripts
npm run dev        # http://127.0.0.1:5173
npm run lint && npm run typecheck && npm test && npm run build
```

## Arsitektur

Tiga lapis, dependensi satu arah `ui -> game -> engine`:

- `src/engine`, `src/scenarios`, `src/codec`: murni, tanpa DOM, jam, atau `Math.random` (ditegakkan ESLint).
- `src/game`: jam, tindakan pemain, tayang ulang.
- `src/ui`, `src/content`: membaca keadaan; tidak menghitung aturan simulasi.

Kontrak beku dan aturan simulasi rinci (model tik, kelayakan, rumus metrik, format kode berbagi) ada di komentar `src/engine/types.ts`, diuji di `tests/contract/`.

## Aturan repositori

Hanya `README.md` di root yang boleh di-commit sebagai Markdown (`tests/contract/repo.test.ts`).
