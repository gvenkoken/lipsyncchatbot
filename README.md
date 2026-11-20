# lipsysncdemo

React + TypeScript + Vite ile hazırlanmış **PMI Assistant**. **Video avatar**, **Avatar + OpenAI**, **Synthesia** ve **Gemini** modları vardır. Varsayılan, gerçek videodan üretilmiş dudak senkronlu **Video avatar** modudur. Yerel Vite sunucusu kimlik bilgilerini sunucuda tutar. Synthesia için Node.js LiveKit agent süreci ilk bağlantıda otomatik açılır; Vite kapatıldığında kapanır. Gemini'nin kendi ürettiği canlı avatar videosu Google Cloud üzerinden alınır.

## Başlatma

Proje klasörü: `C:\Users\koken\Desktop\Me\lipsysncdemo`

```powershell
npm.cmd install
npm.cmd run dev
```

Adres: **http://127.0.0.1:5176/**. `Start-lipsysncdemo.cmd` de geliştirme sunucusunu açar. İlk teslimde bağımlılıklar hazırdır; doğrudan `npm.cmd run dev` çalıştırılabilir. Node.js 22.19 veya üzeri önerilir.

## Kullanım

- Sayfada ızgaralı bir **akış panosu** açılır: Avatar (web) → STT → LLM → TTS → Avatar (web). Kutuya tıklayınca altında seçenekler açılır; alt ortadaki alan seçime göre tahmini aylık maliyeti hesaplar. Sağ alttaki konuşma balonu PMI Assistant'ı açar.
- Sohbetin modu panodaki **Avatar** kutusundan seçilir (Custom / Synthesia / Gemini / Çizim avatar); sohbet kutusunda ayrı bir ayar paneli yoktur. Panoda seçili akış uygulamada bağlı değilse balon gri ve pasif olur, sohbet açılmaz. Başlığın sağında ses, metin görünümü ve kapatma düğmeleri vardır.
- Varsayılan seçim **Custom** (video avatar) + OpenAI. Synthesia seçilince hazır Synthesia avatarı ve OpenAI Realtime kullanılır. Seçimler tarayıcıda saklanır.
- Sağ alttaki **mikrofon düğmesi** seçilen modda canlı konuşmayı başlatır. Mikrofon izni verdikten sonra konuşabilirsiniz; sözünüz bitince asistan Türkçe sesli yanıt verir. Aynı düğme kare durdurma simgesine dönüşür; yeniden basmak oturumu bitirir. Bağlanırken de aynı düğmeyle iptal edebilirsiniz.
- Varsayılan görünüm yalnızca avatardır. Metinler arka planda tutulur ve avatarın boyutunu değiştirmez. Ayarların yanındaki **yazı ikonu** avatarı gizleyip bütün konuşma metinlerini aynı alanda açar; yeniden basmak avatarı geri getirir. Görünüm değiştirmek canlı konuşmayı kesmez.
- Canlı bağlantıda metin gönderimi de aynı OpenAI konuşmasına eklenir; asistan sesli yanıtlar. Mikrofon düğmesi, X veya sayfadan ayrılma mikrofonu, sesi ve bağlantıyı kapatır.
- Synthesia modunda mikrofon canlı LiveKit odasına bağlanır; OpenAI konuşmayı üretir, Synthesia eşlenmiş ses ve avatar videosunu yayınlar. Video ile metin arasında geçiş bağlantıyı korur. Bu modda metin göndermeden önce mikrofonla bağlantıyı başlatın.
- Avatar + OpenAI modunda canlı bağlantı kapalıyken metin gönderimi yerel deneme olarak çalışır: avatar yazılan metni tarayıcının Türkçe sesiyle okur.
- **Avatar + OpenAI modunda ses OpenAI'ye gider. Synthesia modunda LiveKit taşımayı sağlar; OpenAI sesi işler, Synthesia yanıt sesinden avatar videosunu üretir. Gemini modunda ses Google Cloud'a gider; Gemini ses ve avatar videosunu birlikte üretir.** Sayfayı yenilemek mesajları temizler. Mod seçimi korunur.
- Sohbeti kapatmak mikrofonu ve seslendirmeyi durdurur. `Esc` sohbeti kapatır.

Mikrofon için tarayıcı izni gerekir. `localhost`/`127.0.0.1` yerel geliştirme için uygundur.

## Video avatar (varsayılan mod)

Sohbet kutusunun üstünde ~300 px'lik, gerçek videodan çıkarılmış ağız şekilleriyle (viseme) dudak senkronu yapan bir avatar; altında mesaj listesi ve giriş alanı vardır. Sohbet yanıtı, seslendirme ve konuşma tanıma OpenAI ile yapılır; ağız hareketi tarayıcıda sesten hesaplanır.

### Kurulum

1. `.env.example` dosyasını `.env.local` olarak kopyalayın (varsa mevcut dosyaya ekleyin) ve şu satırları doldurun:

```dotenv
OPENAI_API_KEY=anahtariniz
OPENAI_CHAT_MODEL=gpt-5.4-mini
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=ash
OPENAI_STT_MODEL=gpt-transcribe
```

2. `npm.cmd run dev` ile başlatın; Vite `.env.local` değişince kendiliğinden yeniden başlar. Sağ alttaki balona tıklayın.

| Değişken | Ne işe yarar | Varsayılan |
|---|---|---|
| `OPENAI_API_KEY` | Sohbet, seslendirme ve konuşma tanıma | yok: demo modu |
| `OPENAI_CHAT_MODEL` | Sohbet modeli; değiştirmek için yalnızca bu satırı düzenleyin | `gpt-5.4-mini` |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | Ses modeli ve sesi. Adaylar `viseme_analysis/voices/` altında dinlenebilir | `gpt-4o-mini-tts` / `ash` |
| `OPENAI_STT_MODEL` | Mikrofon kaydını yazıya çeviren model | `gpt-transcribe` |

Anahtarlar yalnızca sunucuda (`server/avatar.ts`) okunur; `VITE_` önekiyle tanımlamayın. Tarayıcıya, loglara ve hata mesajlarına yazılmaz. Asistanın üslubu `server/persona.md` dosyasındadır; dosyayı düzenlemek yeterlidir, yeniden başlatma gerekmez.

**Anahtar yokken:** kutu çalışmaya devam eder; avatar **demo modunda** açılır, gömülü bir cümleyi söyler ve mikrofon düğmesi kapalıdır.

### Kullanım

- Yazıp Enter'a basın ya da **mikrofon düğmesini basılı tutarak** konuşun (bırakınca gönderilir). Kısa dokunuş kaydı başlatır; konuşmanız bitince sessizlik algılanıp kendiliğinden gönderilir.
- Yanıt akarken cümlelere bölünür; ilk cümle hemen seslendirilir, diğerleri kuyruğa girip arka arkaya çalınır. Metin, sesiyle birlikte balonda belirir.
- Avatar konuşurken yazmaya ya da konuşmaya başlarsanız susar ve kuyruk temizlenir. Durum etiketindeki kare düğme de susturur.
- Başlıktaki **hoparlör düğmesi** sesi kapatır: yanıtlar yalnızca metin olur, avatar boşta kalır. Yanındaki yazı düğmesi avatarı gizleyip mesaj listesini büyütür.
- Avatar varlıkları (`public/viseme-rig/`, toplam ~0,8 MB) yalnızca kutu ilk açıldığında indirilir.

### Uç noktalar ve sınırlar

`POST /api/avatar/chat` (SSE akışı), `POST /api/avatar/tts` (24 kHz ham PCM), `POST /api/avatar/stt` (webm/opus → metin), `GET /api/avatar/status`. Yalnızca aynı origin'den gelen istekler kabul edilir. Mesaj en fazla 2000, seslendirilecek cümle 600 karakter, ses kaydı 4 MB; dakikada 20 sohbet, 90 seslendirme, 20 konuşma tanıma isteği. Uç noktalar Vite geliştirme/önizleme sunucusunda çalışır; statik `dist/` tek başına yeterli değildir.

### Avatar varlıklarını ve zamanlamayı yeniden üretme

```powershell
cd viseme_analysis\scripts
..\.venv\Scripts\python s11_assets_v3.py          # public/viseme-rig/ atlas + manifest, out_v3/contact_all_v3.png (yama burnun altında)
..\.venv\Scripts\python c01_voices.py             # tüm OpenAI sesleriyle örnek cümle -> viseme_analysis/voices/
..\.venv\Scripts\python c02_calibration_data.py   # 30 cümle TTS + Whisper kelime zamanları
cd ..\..
node scripts/avatar-calibrate.mjs --tune            # alignText hata ölçümü ve ayarı -> out_v2/calibration.json
```

OpenAI TTS zaman damgası vermediği için harf zamanları tarayıcıda sesten tahmin edilir (`src/video-avatar/align.ts`). Zaman damgası veren bir TTS (ör. ElevenLabs with-timestamps) eklemek için `src/video-avatar/timing.ts` içindeki `TimingProvider` arayüzünü uygulayıp `AvatarConversation`'a verin.

### Gerçek tarayıcı testi ve gecikme ölçümü

```powershell
node scripts/avatar-browser-qa.mjs --allow-api --runs 3
```

Kendi görünmez Chrome'unu açar; gerçek sohbet, TTS ve STT çağrısı yapar (ücretlidir). Mesaj → ilk parça → ilk cümle → TTS bitişi → ağzın ilk hareketi sürelerini `artifacts/avatar-video-report.json` dosyasına yazar. Modelleri karşılaştırmak için `OPENAI_CHAT_MODEL` değerini değiştirip yeniden çalıştırın.

## OpenAI bağlantısı

`.env.example` dosyasını `.env.local` olarak kopyalayıp kendi API anahtarınızı ekleyin:

```dotenv
OPENAI_API_KEY=anahtarinizi_buraya_ekleyin
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
```

`.env.local` Git tarafından yok sayılır. Anahtarı `VITE_` önekiyle tanımlamayın, React koduna veya sohbete yapıştırmayın. API kullanımı OpenAI hesabınıza ücretlendirilir. Anahtar ve model erişimi yoksa arayüz bağlantı hatasını gösterir; yerel deneme kullanılmaya devam eder.

Geliştirme ve `npm run preview`, SDP bağlantısını sunucudaki `/api/realtime/session` aracılığıyla kurar. Kalıcı anahtar tarayıcıya gönderilmez. Ses WebRTC ile doğrudan OpenAI'ye gider; sunucu yanıtı `marin` sesiyle gelir. Varsayılan mikrofon transkripsiyonu `gpt-4o-mini-transcribe`, konuşma dili Türkçedir. Diğer sitelerden oturum açma istekleri reddedilir. Statik `dist/` dosyalarını tek başına yayınlamak canlı bağlantıyı çalıştırmaz; dışarıya açılacak bir sürüm için kimlik doğrulamalı bir sunucu gerekir.

Uygulama: [OpenAI Docs — WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime), [Realtime konuşmaları](https://developers.openai.com/api/docs/guides/realtime-conversations).

## Synthesia kurulumu ve anahtarları alma

1. [Synthesia Studio](https://app.synthesia.io/) hesabında **Developers → API keys → New API key** açın. Adı `PMI Assistant`; yetkisi **Interactive Avatars (write)** (`interactive_avatars:write`) olsun. Anahtarı `.env.local` içinde `SYNTHESIA_API_KEY` olarak kaydedin. Yetki görünmüyorsa hesabın Interactive Avatars erişimi için Synthesia desteğine başvurun. Video API / Legacy (v2) yetkisi bu bağlantı için yeterli değildir.
2. Studio **Avatars** bölümünden hesabınızda canlı kullanıma uygun bir **sentetik avatar** seçin. **⋯ → Copy Interactive ID** değerini `SYNTHESIA_AVATAR_DEFAULT_ID` satırına yazın. **Copy ID** ile **Copy Interactive ID** farklı kimlikler döndürebilir. Canlı API genellikle `av_...` biçimini kullanır; SDK, UUID kimliklerine bu öneki ekler. Studio avatarının interaktif dönüşümünü tamamlayıp dönüşümün döndürdüğü kimliği kullanın. Ryan/Ada gibi stok oyuncu avatarları bu API'de çalışmaz; uygulama ham PNG yükleyerek avatar üretmez.
3. [LiveKit Cloud](https://cloud.livekit.io/) üzerinde proje oluşturun. Proje **Settings** sayfasındaki **Project URL** (`wss://...livekit.cloud`) değerini `LIVEKIT_URL` olarak ekleyin. Projenin **API keys** bölümünden anahtar oluşturup `LIVEKIT_API_KEY` ve `LIVEKIT_API_SECRET` değerlerini aynı dosyaya yazın. Bu üç değer aynı projeden gelmelidir.
4. Mevcut `OPENAI_API_KEY` ve model satırlarını koruyun. İlk deneme için aşağıdaki altı değer yeterlidir; `SYNTHESIA_AVATAR_CUSTOM_ID` boş kalabilir:

```dotenv
SYNTHESIA_API_KEY=
SYNTHESIA_AVATAR_DEFAULT_ID=
SYNTHESIA_AVATAR_CUSTOM_ID=
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

Dosyayı kaydedin; Vite yeniden başlar. Sayfayı yenileyip panodaki **Avatar** kutusundan **Synthesia** seçin, sohbeti açıp mikrofon düğmesine basın. Agent ilk kullanımda otomatik açılır; avatarın soğuk başlangıcı daha uzun sürebilir. Görüntü ve agent hazır olmadan arayüz “bağlandı” demez. Kamera izni istenmez.

**Bizim karakter:** İkinci seçenek için Synthesia'nın bu karaktere ait, hesabınızda kullanılabilir bir Interactive ID sağlaması gerekir. Sentetik PNG'yi doğrudan kişisel avatar akışına aktarmanın desteklendiği doğrulanmamıştır; bu seçenek ekranda portre önizlemesi gösterir, Synthesia'da oluşturulmuş gibi davranmaz. ID alınırsa `SYNTHESIA_AVATAR_CUSTOM_ID` satırına yazın. ID yokken bağlantı açık bir yapılandırma mesajıyla durur; yerel avatara gizlice dönmez.

Oturumlar bu yerel demo için aynı anda bir adet ve en fazla bir saattir. Durdurma, kapatma, mod/karakter değiştirme ve sayfadan çıkış mikrofonu, videoyu ve LiveKit odasını temizler. Anahtarlar React'e, localStorage'a veya istemci paketine gönderilmez; tarayıcı sadece kısa ömürlü, tek odaya sınırlı erişim jetonu alır. Gerçek kullanım OpenAI, Synthesia ve LiveKit hesaplarına yansır.

Kaynaklar: [Synthesia anahtar oluşturma](https://docs.synthesia.io/docs/developers), [uygun avatar ve Interactive ID](https://developers.synthesia.io/docs/ia-concepts), [LiveKit bağlantısı](https://docs.livekit.io/intro/basics/connect/), [Synthesia plugin](https://developers.synthesia.io/docs/ia-livekit-plugin-reference).

`unknown_avatar` hatası alırsanız aynı avatarın normal Studio ID'si yerine interaktif dönüşümün döndürdüğü ID'yi kontrol edin. Uygun bir Studio avatarının dönüşümü `POST /api/interactive-avatars/avatars` ile `sourceId` ve `regenerate:false` gönderilerek de yapılabilir; dönen durum `completed` olduğunda `id` kullanılır. API anahtarını doğrulayabilmek, her avatarın canlı kullanıma uygun olduğu anlamına gelmez.

## Gemini 3.8 Live Avatar kurulumu

Bu seçenek Gemini'nin yerleşik canlı avatar videosunu kullanır; yerel sprite avatarı veya Synthesia'ya yönlendirme yapmaz. Başlangıç avatarı **Ben**, ses **Puck**, dil Türkçedir. Varsayılan mod Synthesia olarak kalır.

1. [Google Cloud Console](https://console.cloud.google.com/) üst çubuğundaki proje menüsünden **Yeni proje** oluşturun. Görünen ad `lipsysncdemo` olabilir; oluşan **Proje Kimliği**ni alın (proje numarası veya görünen adı değil).
2. Projeye faturalandırma hesabı bağlayın. **API'ler ve Hizmetler → Kitaplık** bölümünden **Vertex AI API** (`aiplatform.googleapis.com`) etkinleştirin. Hesabınızın projede bu servisi kullanma yetkisi olmalı; proje sahibi değilseniz yöneticiden **Vertex AI User** rolünü isteyin.
3. Windows'ta kurulu Google Cloud CLI ile PowerShell'de aşağıdaki komutları çalıştırın. `PROJE_KIMLIGI` yerine oluşturduğunuz kimliği yazın. Giriş tarayıcıda tamamlanır; parola veya erişim dosyasını sohbete göndermeyin.

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project PROJE_KIMLIGI
```

4. Cloud Console **Studio → Stream realtime** ekranında `gemini-3.8-live` modelini seçip **Live Avatar** erişimini kontrol edin. Video avatar özelliği projeye özel erişim/onay gerektirebilir. Erişim yoksa Google Cloud hesabınızın destek/hesap ekibinden **Gemini 3.8 Live Avatar / VIDEO response modality** erişimini isteyin. Özel bir yüz görseli için ayrıca `customized_avatar` erişimi gerekir; ilk entegrasyon hazır Ben avatarını kullanır.
5. `.env.local` dosyasında aşağıdaki alanları doldurun. Mevcut OpenAI/Synthesia/LiveKit satırlarını koruyun:

```dotenv
GOOGLE_CLOUD_PROJECT=proje-kimliginiz
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_LIVE_MODEL=gemini-3.8-live
GEMINI_AVATAR_NAME=Ben
```

Bu bağlantı standart bir Gemini AI Studio API anahtarı kullanmaz. Kimlik doğrulaması sunucudaki **Application Default Credentials** ile yapılır; OAuth erişim jetonu tarayıcıya gönderilmez. Alternatif olarak `GOOGLE_APPLICATION_CREDENTIALS` alanına yerel bir servis hesabı dosyasının yolunu verebilirsiniz; dosyayı `public/` içine veya Git'e koymayın.

Sayfayı yenileyin, panodaki **Avatar** kutusundan **Gemini** seçin, sohbeti açıp mikrofon düğmesine basın. Başlangıç selamlaması ilk avatar görüntüsünü oluşturur. Mikrofon 16 kHz mono PCM gönderir; Gemini'nin sesle birlikte ürettiği fMP4 videosu tek oynatıcıda açılır. Metin görünümüne geçmek görüşmeyi kesmez. Konuşarak araya girme Google'ın otomatik konuşma algılamasıyla yapılır; avatarın küçük durdurma düğmesi o anki yanıt oynatımını susturur. Mikrofon düğmesi, X, mod değişimi veya sayfadan ayrılma tüm bağlantıyı kapatır. Görüşmeler 9 dakika sonunda kapanır ve yeniden başlatılabilir.

`GET /api/gemini/status` yalnızca yerel yapılandırmayı kontrol eder; bir projenin Live Avatar erişimi ancak gerçek bağlantıda doğrulanır. Proje/kimlik doğrulaması eksikse mikrofon açılmaz. Gerçek Google Cloud proje erişimi olmadan yapılan testler hesabın yetkisini veya gerçek Gemini kalitesini doğrulamaz.

Kaynaklar: [Google Cloud başlangıç](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start), [canlı avatar ve erişim koşulları](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/configure-live-avatars), [Google'ın canlı avatar örneği](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api/gemini-live-studio), [yerel ADC kurulumu](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment).

## AvatarLab'dan taşınan çalışma

- Aynı **1122 × 1117 px** sabit portre.
- **5 ana + 7 ara ağız** katmanı: aynı x480/y520 koordinatı, aynı **184 × 104 px** maske.
- **7 göz** katmanı: x414/y344, **324 × 76 px**; seyrek kırpma 7–11 saniye, bakış değişimi 16–24 saniye.
- Her anda tek ağız ve tek göz katmanı çizilir. 84 birleşimin tamamında maskeler dışında sıfır piksel fark doğrulanır.
- Türkçe metin seslendirmesi, kelime sınırları ve tahmini harf süreleriyle eşlenir. Ara kareler harf süresine sığar; sesin arkasında animasyon kuyruğu oluşmaz.
- Ses kaydı oynatımındaki eşleme Web Audio genlik analizidir; fonem tanıma veya konuşmayı yazıya çevirme değildir.
- Azaltılmış hareket tercihi otomatik gözleri nötr tutar.

## Dosyalar

```text
src/App.tsx                  Sohbet penceresi, ayarlar ve mesaj akışı
src/style.css                Boş sayfa ve duyarlı sohbet arayüzü
src/avatar/Avatar.tsx        Avatar canvas'ı ve göz hareketleri
src/avatar/renderer.ts       Sabit base + ağız + göz çizimi
src/avatar/poses.ts          On iki ağız pozu ve ara geçişler
src/avatar/speech.ts         Yerel Türkçe TTS ve metin eşlemesi
src/avatar/audio.ts          Ses dosyasından ağız hareketleri
src/avatar/eyes.ts           Seyrek göz hareketleri
src/video-avatar/player.ts   Video avatar: canvas çizimi, ses saatine kilitli ağız, göz kırpma, baş hareketi
src/video-avatar/visemes.ts  Türkçe harf -> viseme, geçişler, ses şiddeti bağlantısı
src/video-avatar/align.ts    alignText: sesten harf zamanlaması tahmini
src/video-avatar/timing.ts   TimingProvider arayüzü
src/chat/assistant.ts        Sohbet akışı -> cümle -> TTS -> avatar kuyruğu, söz kesme
src/chat/voice-input.ts      Bas-konuş mikrofonu ve VAD
server/avatar.ts             /api/avatar/chat, tts, stt uç noktaları
server/persona.md            Asistanın sistem promptu
public/viseme-rig/           Video avatar atlası (1x/2x WebP), manifest, demo sesi
src/chat/settings.ts         Sağlayıcı seçenekleri ve yerel kayıt
src/chat/recorder.ts         Mikrofon, ses dosyası ve kaynak temizliği
src/chat/realtime.ts         WebRTC, canlı transkriptler ve oturum temizliği
src/chat/synthesia.ts        LiveKit mikrofonu, avatar videosu ve veri kanalı
src/chat/gemini.ts           Gemini mikrofonu, WebSocket ve konuşma yaşam döngüsü
src/chat/gemini-player.ts    Ses içeren fMP4 avatar akışını oynatan MediaSource
server/realtime.ts           Sunucuda kalan anahtar, SDP aktarımı ve oturum kapatma
server/synthesia.ts          Synthesia durum bilgisi, oda jetonu ve odayı kapatma
server/synthesia-manager.ts  Agent sürecinin otomatik başlatılması ve kapatılması
server/synthesia-agent.ts    OpenAI Realtime + Synthesia avatar ses/video köprüsü
server/gemini.ts             Sunucuda Google Cloud OAuth ve Gemini Live bağlantısı
public/gemini-pcm-worklet.js  Mikrofonu 16kHz PCM'e dönüştüren AudioWorklet
vite.config.ts              Yerel geliştirme/önizleme sunucusuna API uç noktaları
public/mouth-rig/            On iki ağız PNG'si, maske ve manifest
public/eye-rig/              Yedi göz PNG'si ve birleşik base
scripts/prepare-*.ps1        Özgün kaynaklardan katmanları yeniden çıkarma
tests/                      Avatar zamanlaması ve mikrofon yaşam döngüsü
scripts/browser-qa.mjs      Arayüz, gerçek medya API'leri ve piksel kontrolü
```

Çalıştırmak için AvatarLab klasörüne bağımlılık yoktur. Katmanları yeniden üretmek istenirse hazırlama scriptleri özgün kaynak PNG'lerini Downloads klasöründen okur; kaynakları değiştirmez.

## Kontroller

```powershell
npm.cmd run build
npm.cmd test
```

Birim testleri göz/ağız zamanlamasını, ses dosyası oluşumunu, geç gelen mikrofon akışının durdurulmasını, canlı bağlantı yaşam döngüsünü, transkriptleri, kesme/sessize alma işlemlerini ve sunucunun anahtar/origin sınırlarını kapsar. Synthesia testleri iki avatarın doğru kimlikle gönderilmesini, jetonun tek odaya/mikrofona sınırlanmasını, iptal edilen isteğin geç yanıtını, yerel agent sürecinin gerçekten açılıp kapanmasını ve kaynak temizliğini doğrular. Gemini testleri OAuth, kaynak sınırı, WebSocket temizliği, video/transkript aktarımı, gerçek AVC codec tespiti ve farklı mikrofon örnekleme hızlarını kapsar. Gerçek sağlayıcı çağrısı yapılmaz.

Tarayıcı kontrolü için geliştirme sunucusu açıkken, ayrı bir görünmez Chrome test oturumu başlatın:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-test-browser.ps1
npm.cmd run test:browser
```

Bu test 9346 portundaki ayrı Chrome'u kullanır. Gerçek tarayıcı medya API'leri, yerel TTS ve taklit edilen OpenAI/Synthesia/Gemini bağlantıları ile başlatma/durdurma/iptal, avatar/metin geçişleri ve mobil görünüm doğrulanır. Synthesia video testi gerçek tarayıcı video izleri üzerinde sahte akış kullanır. Gemini testi tarayıcıda H264/AAC fMP4 üretip gerçek MediaSource oynatıcısında açar ve gerçek mikrofon/worklet PCM aktarımını kontrol eder. Bunlar gerçek sağlayıcı kalitesini veya hesap erişimini doğrulamaz; ücretli çağrı gönderilmez. Rapor ve ekran görüntüleri `artifacts/` klasörüne yazılır.

Gerçek OpenAI bağlantısını sınamak için aynı test tarayıcısı açıkken `node scripts/live-qa.mjs --allow-api` çalıştırılabilir. Bu ayrı kontrol ücretli bir sesli oturum açar, kısa bir yanıt ister, gelen sesin ağız pozlarını hareket ettirdiğini ve kapatmanın mikrofonu/oturumu serbest bıraktığını doğrular. Başlangıçta test mikrofonu sessizdir; kişisel ses kaydı göndermez. Rapor `artifacts/live-openai-report.json` dosyasına yazılır.

Gerçek Synthesia için `node scripts/live-synthesia-qa.mjs --allow-api` kullanılır. Bu kontrol ücretli bir Synthesia/LiveKit/OpenAI oturumu açar; sessiz test mikrofonuyla kısa Türkçe metin gönderir, gerçek video ve ses alımını, metin/video geçişini ve tüm izlerin kapatılmasını doğrular. Rapor `artifacts/live-synthesia-report.json` dosyasındadır. Normal otomatik testler bu kontrolü çalıştırmaz.
