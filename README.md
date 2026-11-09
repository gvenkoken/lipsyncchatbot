# Lypsync

Derleme adımı ve harici paket gerektirmeyen ES modülü iskeleti.
Node.js 20 veya üzeri ve npm yeterlidir. Paket kurulumu gerekmez.

Depo kökünde `npm start` çalıştırın ve http://localhost:8080 adresini açın.
Sunucu yalnızca `web/` klasörünü sunar. Durdurmak için Ctrl+C kullanın.
`file://` ile açmak desteklenmez; ES modülleri HTTP üzerinden yüklenmelidir.

`npm test`, `node:test` ile `tests/` altındaki ve alt klasörlerindeki bütün
testleri bir kez çalıştırır, ardından uçtan uca (`*.e2e.test.js`) testleri
çalıştırır. Dosyaları `scripts/run-tests.mjs` listeler; böylece Node.js'in
sürüme göre değişen dizin ve glob davranışına bağlı kalınmaz.
Harici paket veya internet bağlantısı gerekmez. Smoke testi yerel, rastgele
bir port kullanır ve sunucuyu test sonunda kapatır.

`#karakter-testi` (T11) ve `#karsilastirma` (T12) yer tutucuları açar.
Boş veya bilinmeyen hash, karakter testini gösterir. Görsel ekranlar ve
tasarım sistemi sonraki görevlerde eklenecektir.
`tests/helpers/` sahte DOM, Clock ve Random yardımcılarını içerir.

## Ses kalitesi

Seslendirme tarayıcının kendi Türkçe seslerini kullanır; kalite büyük ölçüde
hangi sesin kurulu olduğuna bağlıdır. Otomatik seçim en doğal sesi seçer:
önce Edge'in "Online (Natural)" sinir ağı sesleri, sonra Apple'ın indirilen
Premium/Enhanced sesleri, sonra Chrome'un "Google Türkçe" sesi, en son temel
sistem sesi. Panelin "Ses" listesinden başka bir Türkçe ses seçilebilir.

macOS'ta daha doğal bir ses için: Sistem Ayarları → Erişilebilirlik →
Seslendirilen İçerik → Sistem sesi → Sesleri Yönet → Türkçe → Yelda
(Gelişmiş/Premium) indirin, ardından tarayıcıyı yeniden başlatın.

Ağız hareketi her cümlenin gerçek başlangıcında yeniden hizalanır, kelime
olayları geldiğinde kelime başına düzeltilir ve sesin ölçülen hızı sonraki
cümlelere uygulanır. Metindeki emoji ve markdown işaretleri okunmaz; satır
sonları cümle sonu gibi okunur.

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
