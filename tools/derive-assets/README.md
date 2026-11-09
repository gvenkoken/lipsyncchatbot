# Kaynaktan ayrı avatar varlık hattı

Depo kökünden `node tools/derive-assets/index.mjs` çalıştırılır. Paket indirme,
harici servis veya yeniden kodlanmış kaynak kopyası gerektirmez. Node'un zlib
modülüyle 8-bit RGB/RGBA, interlace olmayan PNG dosyaları okunur; kaynaklar
yalnız okunur, kırpımlar `assets/derived/avatar-N` dizinine yazılır.

Bu görevde ikili dosya eklenmesi yasak olduğundan depoda manifestler ve kaynak
özetleri bulunur. PNG dosyalarını uygulamayı paketlemeden önce bu komut üretir.
Vitest bütünlük testi aynı hattı geçici dizinde çalıştırır; kaynak özetlerini,
kayıtlı manifestleri, PNG verilerini, sınırları ve kanal ankrajlarını karşılaştırır.

Her avatar için ilk nötr portre sabit tabandır. Göz, kaş ve ağız yamaları aynı
portreden, ölçeklenmeden alınır. Koordinatlar kaynak piksel koordinatlarıdır;
manifest ankrajları tabanın sol üst köşesine göredir. Kontur hiçbir ek yamaya
dahil edilmez. Aynı kanaldaki tüm pozlar aynı kırpım ve ankrajı kullanır.

Atlaslardaki bağımsız pozların yüz geometrisi ve ışığı farklıdır. Bu nedenle
hizalanmış animasyon pozu olarak kullanılmazlar. Güvenli biçimde türetilemeyen
yarı açık/kapalı göz ve konuşma visemeleri `türetilecek` notuyla nötr yama
olarak açıkça işaretlidir. Bu çıktılar konuşma animasyonunun tamamlanmış görsel
malzemesi değildir. Hizalanmış poz çizimi ve insan tarafından geçiş incelemesi
gereklidir; nötr yama kullanımı bu sırada renk farkı veya kontur kayması yaratmaz.

Kaynak özeti kaydı, kaynak değişikliğini onaylamak için otomatik güncellenmemelidir.
Araç çalıştırılmadan önce mevcut bütünlük kaydıyla kaynaklar karşılaştırılmalıdır;
değişen kaynaklar ayrıca incelenmelidir.
