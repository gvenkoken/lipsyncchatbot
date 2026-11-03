# Türev görselin elle incelenmesi

Karakter testi panelindeki “Görsel karşılaştırması” bağlantısı #karsilastirma görünümünü açar. “Karakter testine dön” bağlantısıyla geri dönülür.

1. Özgün `/assets/owner/akilay2-removebg-preview-1.png` ile ayrı hazırlanmış `/assets/generated/akilay2-face-base.png` dosyasını yan yana inceleyin. Türev yoksa inceleme tamamlanamaz.
2. Her iki doğal boyutun 463 × 539 olduğunu doğrulayın. Üst üste kipini açıp görünürlüğü değiştirin. Yalnızca ağız ve göz bölgeleri çevredeki cilt rengiyle doldurulmuş olmalı; saç, yüz hatları, kıyafet, gövde, renkler ve oranlar korunmalı.
3. Damalı zeminde şeffaf arka planı ayrıca kontrol edin. Ekran şeffaflığı otomatik doğrulamaz. Kontrol kutuları geçicidir; hiçbir karar kaydedilmez. Durum her zaman “İnceleme bekleniyor” kalır.
4. Gerçek kullanıcı karşılaştırmayı açıkça onayladıktan sonra proje sahibi `web/config/lypsync.config.json` içindeki `body.src` değerini elle `assets/owner/akilay2-removebg-preview-1.png` yerine `assets/generated/akilay2-face-base.png` yapar. `body.width` ve `body.height` 463 ve 539 kalır. Ekran ayarı değiştirmez ve onay üretmez.
5. Özgün dosyayı değiştirmeyin, üzerine yazmayın, yeniden adlandırmayın. Onaylanmayan türevi yeniden hazırlayın. Ayar değişikliğinden sonra karakter testini açarak görüntüyü kontrol edin.
