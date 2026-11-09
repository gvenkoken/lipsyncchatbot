# Avatar Atölyesi · Sakin odak

Sıcak gri zemin ve beyaz kontrol yüzeyleri avatarı öne çıkarır. Tasarımın ortak kaynağı `web/src/theme/tokens.ts` ve `tokens.css` dosyalarıdır. Sonraki ekranlar renk, yazı, boşluk, yarıçap ve gölge değerlerini bu modülden alır; ekranlarda yeni değerler tanımlanmaz. Ortak bileşenler `web/src/components` üzerinden kullanılır ve tema stillerini yükler.

- Mor vurgu yalnızca ana eylem, seçim ve etkin gezinmede kullanılır.
- Renk tek başına anlam taşımaz. Konuşma, bekleme, düşünme, yükleme ve hata durumları Türkçe metinle belirtilir.
- Masaüstünde geniş avatar yüzeyi ve yan kontrol sütunu; dar ekranda tek sütun kullanılır. Dokunma hedefleri en az 44 px, klavye odağı belirgin olmalıdır.
- Seçicide yalnızca verilen Avatar 1–4 seçenekleri numara sırasıyla görünür. Küçük yüz önizlemeleri gösterilmez. Tam kaynak yolu kaynak kartında yer alır.
- `avatar.png` yalnızca görsel incelemede sabit referanstır; seçilebilir avatar değildir. Gerçek kaynak yerine temsili yüz üretilmez.
- AvatarStage tuvali motor tarafından çizilir; Türkçe durum ve isteğe bağlı FPS ayrı DOM metinleridir. FPS kapalıyken metni de kaldırılır. Hedef 60 FPS, kabul alt sınırı belirgin takılma olmadan 30 FPS'dir.
- ActionButton ana, ikincil, durdurma, simge ve sağ alt panel açıcı varyantlarını sağlar. Simge düğmesine erişilebilir ad verilir. Devre dışı eylem için neden zorunludur ve yanında görünür.
- Notice bilgi, uyarı ve hata için başlık ve açıklama içerir. Hata yeniden deneme sunar. Türkçe ses bulunmaması bekleme ve düşünme animasyonlarını engellemez.
- SpeechForm kontrollüdür; ekran ses, hız, perde ve metni avatar seçiminden bağımsız korur. Sabit cümleler ve son seslendirilen metin yakınında yer alır.
- ReviewItem tarafsız “Değerlendirilmedi” durumuyla başlar. Kusur notları insan tarafından girilir; değerlendirmeler kendiliğinden sonuç veya uygunluk kararı üretmez.
- SourceCard tam yolu, kaynak ilişkisini ve eksik notunu düz metinle gösterir. Teknik yollar yalnızca kaynak incelemesinde kullanılır.
- Kullanıcı metni React metin düğümleriyle gösterilir; HTML yorumlanmaz. Bileşenler HTTP çağrısı veya motor uygulaması içermez.

Tipografi: system-ui ailesiyle başlık 32/40 600, bölüm 20/28 600, gövde 15/24 400, etiket 14/20 600, yardımcı bilgi 12/18 500; yollar ui-monospace 12/20 400. Boşluk dizisi 4, 8, 12, 16, 24, 32, 48 px; yarıçaplar 8, 12, 20 ve 999 px'dir. Kart, panel ve odak gölgeleri tema üzerinden uygulanır.

Bu görev ortak tasarım sistemini sağlar. Sonraki ekran görevleri Deneme alanı, Kalite kaydı ve Görsel inceleme rotalarındaki yer tutucuları bu bileşenlerle değiştirir. Bileşen testleri rol, metin, seçim ve çağrıları doğrular; jsdom üzerinde konum veya boyut doğrulamaz.
