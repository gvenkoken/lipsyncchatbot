# Lypsync elle kabul kaydı

Sonuçları gerçek kullanıcı doldurur. Otomatik testler tarayıcı kabulü veya türev onayı değildir. Uygulamayı yerel statik HTTP sunucusundan açın. Her ortam için aşağıdaki kontrol tablosunu ayrı doldurun; boş alanlar henüz değerlendirilmemiştir.

| Ortam | Tam sürüm | Tarih | Geçti/kaldı | Not |
| --- | --- | --- | --- | --- |
| Windows 10 Chrome güncel | | | | |
| Windows 10 Chrome önceki sürüm | | | | |
| Windows 11 Chrome güncel | | | | |
| Windows 11 Chrome önceki sürüm | | | | |
| macOS Chrome güncel | | | | |
| macOS Chrome önceki sürüm | | | | |
| macOS Safari güncel ana sürüm | | | | |
| macOS Safari önceki ana sürüm | | | | |

Örnek metinler:

- Kısa: “Merhaba, bugün nasılsın?”
- m/b/p ve yuvarlak ünlüler: “Pembe bir balon buldum. Onu büyük, yuvarlak bir kutunun üzerine koydum.”
- Uzun: “Bugün birlikte küçük bir konuşma deneyi yapıyoruz. Pembe bir balon buldum. Onu büyük, yuvarlak bir kutunun üzerine koydum. Şimdi biraz durup yeniden konuşacağız.”

Ortam / tam sürüm: __________  Tarih: __________  Değerlendiren: __________

| Kapsam | İşlem ve beklenen gözlem | Geçti/kaldı | Not |
| --- | --- | --- | --- |
| AC01 | İkonla açın. Varsayılan selamlama yaklaşık 1,5 saniyede başlasın; başlangıçta ağız açılsın, bitince kapansın ve Hazır görünsün. | | |
| AC02 | m/b/p ve yuvarlak ünlülü örneği dinleyin; dudak kapanması ve yuvarlak şekilleri gözlemleyin. | | |
| AC03 | Örneği 2–3 kez okutun; ağız geçişlerinde titreme veya ani atlama arayın. | | |
| AC04 | Boşta ve konuşurken ayrı ayrı 1–2 dakika izleyin; göz kırpma doğal, düzensiz ve 2–6 saniye aralığında olsun. | | |
| AC05 | Bu ortamda paneli açma, ses, kontroller ve kapanmayı doğrulayın. Boundary olayı bulunmayan ortamda tahminle animasyonun sürdüğünü gözlemleyin. | | |
| AC06 | Kısa cümleyi ve dört cümlelik paragrafı Seslendir ile okutun; tamamı sırayla okunsun, sonunda ağız kapansın ve Hazır görünsün. | | |
| AC07 — metin girişi | Örnek metni kendi cümlenizle değiştirip Seslendir seçin; girilen metin okunsun. Boş ve yalnız boşluk içeren metinde konuşma başlamasın. | | |
| AC08 | Uzun paragraf sürerken yeni kısa metinle Seslendir seçin; eski ses kesilsin, ağız kapansın, yalnız yeni metin baştan okunsun. | | |
| AC09 | Konuşurken ikonla kapatın; ses ve ağız dursun. Tekrar açınca selamlama tekrarlansın. Ayarda delayMs 800 ile tekrar deneyin. | | |
| AC10 — ses kontrolleri | Hızı ve tonu ayrı ayrı 0,5 ve 1,5 yaparak aynı metni tekrar okutun; sonraki okumaya uygulansın. Kullanıcı değişiklikleri sayfa yenilendiğinde kaydedilmesin. | | |
| AC11 | Ayar dosyasında selamlama metni ve delayMs değerini değiştirin; paneli yeniden açınca yeni metin ve süre kullanılsın. Başlangıç hız/ton değerlerini değiştirip sayfayı yenileyin ve kontrolleri doğrulayın. Sonunda ayarı geri alın. | | |
| AC02 — senkron | Başlangıç, duraklama ve bitişte ses/ağız uyumunu gözlemleyin. Yaklaşık 150 ms kayma yalnız gözlem rehberidir, kesin geçme eşiği değildir; farkın yönünü ve tahmini büyüklüğünü not edin. | | |
| AC12 — türev inceleme | Görsel karşılaştırması sayfasında özgün ve türevi yan yana inceleyin: yalnız ağız/göz bölgeleri çevredeki cilt rengiyle doldurulmuş olsun; 463 × 539 boyut, şeffaflık ve kalan görüntü korunsun. Görseller yoksa inceleme yapılamadığını not edin. | | |
| AC13 — kaynak koruma ve türeve geçiş | Özgün dosya değiştirilmesin, üzerine yazılmasın ve yeniden adlandırılmasın. Türev ayrı dosyada tutulsun; gerçek kullanıcı onayı ve elle body.src değişikliği olmadan etkinleşmesin. Karşılaştırma ekranındaki kontroller ayarı değiştirmesin veya onay kaydetmesin. | | |
| AC14 | Türkçe ses olmayan ortamda varsayılan ses ve kapatılabilir uyarıyı doğrulayın; tr-TR sesi sonradan gelirse sonraki okumada seçilsin ve uyarı tekrarlanmasın. Denenemeyen koşulu not edin. | | |
| AC15 | Ayar dosyasında yalnız mouth/eyes koordinatlarını değiştirip paneli yeniden açın; katmanlar yeni koordinatları kullansın. Ardından ayarı geri alın. | | |

Türev incelemesi için [ayrıntılı inceleme kaydı](derivative-review.md) kullanılır. Bu liste onay üretmez. Türeve geçiş gerçek kullanıcının açık onayı ve ayar dosyasının elle değiştirilmesini gerektirir; özgün dosyaya dokunulmaz.
