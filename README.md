# Avatar Atölyesi

React + TypeScript + Vite ile hazırlanan, backend gerektirmeyen avatar prototipi.
T01 kapsamında üç yer tutucu ekran ve test altyapısı bulunur. Ses adaptörü,
animasyon motoru ve gerçek ekran kontrolleri sonraki görevlerin kapsamındadır.

## Çalıştırma

Node.js 22 ve npm kullanın. Komutları web/ içinde çalıştırın:

```sh
cd web
npm install
npm run dev
```

Bu checkout'ta kilit dosyası üretilmedi. İlk kurulum npm install ile yapılır;
oluşan package-lock.json saklandıktan sonra temiz klonlarda npm ci kullanılır.
Tamamen çevrimdışı kurulum için bağımlılıkların npm önbelleğinde bulunması gerekir
(npm ci --offline). Uygulama çalışma sırasında HTTP API, CDN, uzak yazı tipi
veya üçüncü taraf betik çağırmaz.

```sh
npm run build
npm test
npm run e2e
npx playwright test --list
```

build, TypeScript kontrolünü ve Vite üretim derlemesini çalıştırır. test,
Vitest'i tek sefer çalıştırır; src/**/*.test.ts, src/**/*.test.tsx ve
tests/**/*.test.ts dosyalarını jsdom ortamında kapsar. Testler ağ gerektirmez.
Rota testleri doğrudan açılışı, menüyle geçişi ve etkin bağlantıyı doğrular.

e2e öncesinde üretim derlemesini hazırlayın. Playwright, Vite preview sunucusunu
127.0.0.1:4173 üzerinde başlatır ve test sonunda kapatır. Chromium, Firefox ve
WebKit projeleri aynı gezinme smoke testini çalıştırır. Bu tarayıcıların önceden
ortama kurulmuş olması gerekir; test komutları tarayıcı indirmez.
--list komutu üç projenin testlerini sunucu başlatmadan listeler.

## Rotalar ve statik varlıklar

- /: Avatar deneme alanı (T12 yer tutucusu).
- /kalite: Kalite ve ortam kaydı (T13 yer tutucusu).
- /gorsel: Görsel ve kaynak incelemesi (T14 yer tutucusu).

Vite publicDir ayarı depo kökündeki assets/ dizinini kullanır. Örneğin
assets/owner/avatar.png, aynı kaynaktan /owner/avatar.png olarak sunulur
ve derleme çıktısına değişmeden alınır. Kaynak görseller değiştirilmez.
Üretim sunucusu istemci rotaları için index.html dosyasına dönüş sağlamalıdır.

## Tasarım kuralları

Sıcak gri zemin, beyaz kartlar ve mor etkin gezinme kullanılır. Sistem yazı
tipleri ağ gerektirmez. Renk, tipografi, boşluk ve köşe değişkenleri, bu görevin
izin verdiği ortak konum olan web/src/app/theme.css içindedir; yerleşim
layout.css üzerinden bu değişkenleri kullanır. Dar ekranda gezinme satırları
akar; klavye odağı ve içeriğe geç bağlantısı bulunur. Yer tutucular herhangi bir
kalite sonucu veya insan onayı üretmez.
