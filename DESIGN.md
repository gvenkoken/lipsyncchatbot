# Lypsync · Sakin sahne

## Palet
Tema kaynağı `web/src/theme/index.js`; `applyTheme(document)` bütün belirteçleri `--lypsync-*` CSS değişkenleri olarak kök belgeye uygular.

| Rol | Değer |
| --- | --- |
| primary | #6544C4 |
| secondary | #4E329D |
| accent | #F0EBFA |
| background | #F7F6F3 |
| surface | #FFFFFF |
| text | #252330 |
| muted | #696571 |
| border | #DEDCE4 |
| success | #26704F |
| warning | #805015 |
| neutral | #FFF5E4 |
| error | #AF3542 |
| info | #335E91 |

## Tipografi
Yazı ailesi: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif.

| Düzey | Boyut / satır (px) | Kalınlık |
| --- | --- | --- |
| display | 40 / 48 | 600 |
| heading | 24 / 32 | 600 |
| title | 18 / 26 | 600 |
| body | 15 / 24 | 400 |
| label | 14 / 20 | 600 |
| small | 12 / 18 | 400 |

## Boşluk, köşe ve gölge
Boşluklar (px): xs=4, sm=8, md=12, lg=16, xl=24, xxl=32, section=48, hero=64.
Köşe yarıçapları (px): sm=8, md=12, lg=20, pill=999.

- card: `0 2px 8px rgba(37, 35, 48, 0.04)`
- panel: `0 20px 64px rgba(37, 35, 48, 0.16), 0 4px 12px rgba(37, 35, 48, 0.06)`
- focus: `0 0 0 4px rgba(101, 68, 196, 0.18)`

## Bileşenler ve kullanım
`web/src/components/index.js` belgeyi ilk argüman olarak alan DOM fabrikalarını sunar. `components.css` statik stil dosyası olarak yüklenir ve tema uygulandıktan sonra kullanılır. Düğme ve sahne doğrudan DOM elemanı; diğer fabrikalar `element` kökü ve ilgili kontrol tutamaçlarını döndürür.

- Eylem düğmesi: primary, secondary, icon; devre dışı durumda eylem çalışmaz.
- Panel açma ve kapatma ikonu: erişilebilir ad ve aria-expanded; `setExpanded` dış durumla eşler.
- Karakter paneli: sağ alta sabit widget-panel; içerik yuvası ve kapatma geri çağrısı.
- Karakter sahnesi: 463:539 oran; sağlanan görseli korur, görsel verilmezse açık bir bekleme metni gösterir. Özgün görsel yeniden çizilmez veya değiştirilmez.
- Seslendirilecek metin: görünür etiket ve aria-describedby ile bağlı yardım metni.
- Hız ve ton kaydırıcısı: ayrı id ve etiket, 0.5–1.5 aralığı, 0.1 adım, varsayılan 1; ayardan başlangıç değeri alınabilir. Görünen sayı Türkçe ondalık ayracı kullanır. onChange sayısal değer verir. Değerler oturumda tutulur, sonraki seslendirmeye uygulanır, kalıcı kaydedilmez.
- Kapatılabilir bildirim: warning, error, info; kapatma konuşmayı engellemez.
- Durum etiketi: Hazır, Selamlama bekleniyor, Konuşuyor, İnceleme bekleniyor.

## Erişilebilirlik ve dar ekran
Etkileşim alanları en az 44 piksel genişlik ve yüksekliktedir. Klavye odağı görünürdür. Renk tek başına anlam taşımaz; durumlar metinle belirtilir. Kullanıcı metinleri textContent veya formun value özelliğiyle işlenir.

Dar ekranda sayfalar tek sütuna geçer; panel ekran kenarlarında boşluk bırakır ve kendi içinde kaydırılabilir kalır. Karakter ve yüz katmanları aynı 463:539 koordinat alanını kullanır.

Karşılaştırma görünümü insan onayı verilmiş izlenimi oluşturmaz. İnceleme bekleniyor etiketi korunur; türev dosyaya geçiş gerçek kullanıcı onayı ve ayar dosyasının elle değiştirilmesini gerektirir. T02 yalnızca ortak bileşenleri sağlar; ekran montajı T11 ve T12 kapsamındadır.
