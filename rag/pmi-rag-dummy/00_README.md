# Philip Morris senaryosu — RAG için sentetik Markdown paketi

> **UYARI: RESMÎ ŞİRKET BELGESİ DEĞİLDİR.** Bu ZIP dosyasındaki bütün içerik, uygulama, portal, destek birimi, süreç ve örnek akışlar **kurgu/dummy** veridir. Philip Morris International veya Türkiye iştirakleri tarafından hazırlanmış, doğrulanmış ya da onaylanmış değildir. Özellikle çalışan hakları, ticari koşullar ve yasal gereklilikler için gerçek kaynağa başvurulmalıdır.

## Kapsam

- **Çalışanlar (employee):** İK, IT, masraf/seyahat/satın alma, bilgi güvenliği, genel SSS.
- **Bayiler ve iş ortakları (partner):** onboarding, portal erişimi, destek talepleri, belge, finans, entegrasyon, kalite ve uyum başvuru yolları.
- **Ortak (shared):** İki kitleye de açık genel kullanım ve yönlendirme ilkeleri.

## Kullanılacak metadata

Her `.md` dosyası YAML frontmatter içerir:

| Alan | Örnek | Kullanım |
|---|---|---|
| `id` | `EMP-IT-001` | Benzersiz doküman kimliği |
| `audiences` | `["employee"]` | Sunucu taraflı yetki filtresi |
| `access_level` | `employee_internal` | Erişim ayrımı |
| `category` | `it` | Kategorik daraltma |
| `tags` | `["vpn","uzak erişim"]` | Hibrit/anahtar kelime arama |
| `status` | `synthetic_demo` | Üretim ortamında **hariç tut** |
| `source_type` | `synthetic_demo` | Provenance ve kaynak takibi |
| `last_reviewed` | `2026-11-13` | Demo sürüm tarihi; gerçek onay değildir |

## RAG için kritik kurallar

1. **Yetki filtresi aramadan önce uygulanmalı.** Oturumdaki kullanıcı kitlesini güvenilir kimlik sağlayıcıdan al. `employee` -> yalnızca `employee` veya `shared` dokümanlar; `partner` -> yalnızca `partner` veya `shared` dokümanlar. İstemciye gönderilen `audience` parametresine tek başına güvenme.
2. **Partner bazlı izolasyon:** Gerçek işlem verileri eklenecekse ayrıca `partner_id`/tenant filtresi uygula. Bu pakette gerçek partner verisi yoktur.
3. **Üretimde sentetikleri gösterme:** `status: synthetic_demo` dokümanları yalnızca test indeksinde tutulmalı. Gerçek ortamda resmi belgeyle değiştir, belge sahibi onayı al ve statüsünü ayrıca düzenle.
4. **Kaynak göster:** Yanıtla birlikte en az doküman başlığı/ID ve mümkünse alıntılanan bölüm döndür.
5. **Bilgi yoksa bilmiyorum de:** İzin bakiyesi, ödeme durumu, ticket bilgisi, sözleşme ve bireysel veriler için MD yerine yetkilendirilmiş gerçek API kullanılmalı.
6. **Gizli bilgi toplama:** Bot parola, MFA kodu, API anahtarı veya kimlik/banka bilgisi istememeli.
7. **Tütün/nikotin ürünleri pazarlaması yapma:** Bu bilgi tabanı yalnızca kurumsal ve operasyonel destek için düzenlendi; promosyon, tüketime özendirme, satış veya ürün önerisine yönelik içerik yoktur.

## Önerilen teknik akış

`Kimlik doğrulama -> kitle/tenant yetkisi -> yetki filtreli hibrit arama -> top-k doküman -> LLM -> kaynaklı yanıt`

Başlangıç için belge başlıkları ve H2/H3 bölümleri temelinde 300-700 token civarı chunk'lar kullan. Uzun doküman büyüdükçe 10-15% overlap ekle. Metadata'yı chunk düzeyinde koru. Sayısal eşikler uygulamanın diline, embedding modeline ve gerçek içerik boyutuna göre test edilmelidir.

## Demo sistem adları

`DemoDesk`, `PartnerDesk`, `DemoProcure`, `Çalışan Portalı` ve `Partner Portalı` burada yalnızca kurgusal örnek modüllerdir. `https://partner.pmi-demo.example` çalışmayan, yer tutucu adrestir. Gerçek iç URL, e-posta, telefon, SLA ve politika limitleri yerine geçmez.

## Testler

`00_test_questions.md` dosyasındaki sorular ile hem cevap doğruluğunu hem de çalışan/partner erişim ayrımını test et.
