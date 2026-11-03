# Lypsync

Derleme adımı ve harici paket gerektirmeyen ES modülü iskeleti.
Node.js 20 veya üzeri ve npm yeterlidir. Paket kurulumu gerekmez.

Depo kökünde `npm start` çalıştırın ve http://localhost:8080 adresini açın.
Sunucu yalnızca `web/` klasörünü sunar. Durdurmak için Ctrl+C kullanın.
`file://` ile açmak desteklenmez; ES modülleri HTTP üzerinden yüklenmelidir.

`npm test`, `node:test` ile `tests/` altındaki testleri bir kez çalıştırır.
Komut `node --test tests/*.test.js` kullanır; böylece dizin girişini
çözemeyen Node.js sürümlerinde de test dosyaları doğrudan bulunur.
Harici paket veya internet bağlantısı gerekmez. Smoke testi yerel, rastgele
bir port kullanır ve sunucuyu test sonunda kapatır.

`#karakter-testi` (T11) ve `#karsilastirma` (T12) yer tutucuları açar.
Boş veya bilinmeyen hash, karakter testini gösterir. Görsel ekranlar ve
tasarım sistemi sonraki görevlerde eklenecektir.
`tests/helpers/` sahte DOM, Clock ve Random yardımcılarını içerir.
