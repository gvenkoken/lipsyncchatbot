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

## Ideafactra canlı önizlemesi ve Docker Compose

Ideafactra canlı önizlemesi depo kökündeki `compose.yaml` dosyasını kullanır.
Docker Compose ile çalıştırmak için depo kökünde:

```sh
export APP_PORT=8080
docker compose up --build
```

Uygulamayı `http://127.0.0.1:${APP_PORT}` adresinde açın (`APP_PORT=8080`
için http://127.0.0.1:8080). Ayrı bir terminalde aynı portu ayarlayıp
hazır olma kontrolünü çalıştırın:

```sh
export APP_PORT=8080
curl --fail -i "http://127.0.0.1:${APP_PORT}/health/ready"
```

`GET` ve `HEAD /health/ready` istekleri HTTP 200 döndürür. Compose da bu
adresi healthcheck için kullanır. Durdurmak için Ctrl+C, kaynakları kaldırmak
için `docker compose down` kullanın.

Yerel sunucu `PORT` ve `HOST` ortam değişkenlerini okur; varsayılanları
sırasıyla `8080` ve `localhost` değerleridir. `npm start` ile çalıştırma
geçerliliğini korur. Konteynerde bu değerler `PORT=8080` ve `HOST=0.0.0.0`
olarak ayarlanır; `APP_PORT` yalnızca ana makinedeki erişim portunu belirler.
