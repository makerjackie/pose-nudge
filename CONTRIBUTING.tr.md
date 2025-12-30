# Pose Nudge'a Katkıda Bulunma

Öncelikle, Pose Nudge'a katkıda bulunmayı düşündüğünüz için teşekkür ederiz! Yardımınız, projenin harika kalması için çok önemli.

Bu belge, projeye katkıda bulunmak için bir dizi rehber sunmaktadır. Bunlar çoğunlukla yönergelerdir, katı kurallar değil. Kendi yargınızı kullanın ve bu belgedeki değişiklikleri bir pull request ile önermekten çekinmeyin.

Tüm katılımcıların [Davranış Kuralları](CODE_OF_CONDUCT.md)'na uyması beklenmektedir.

## 🤝 Nasıl Katkıda Bulunabilirim?

-   [🐛 Hata Bildirme](#-hata-bildirme)
-   [🚀 Geliştirme Önerileri](#-geliştirme-önerileri)
-   [💻 İlk Kod Katkınız](#-ilk-kod-katkınız)
-   [🔃 Pull Request Süreci](#-pull-request-süreci)

---

## 🐛 Hata Bildirme

Hatalar [GitHub issues](https://github.com/dduldduck/pose-nudge/issues) olarak takip edilmektedir. Bir hata raporu oluşturmadan önce, sorunun zaten bildirilip bildirilmediğini görmek için mevcut sorunları kontrol edin.

Bir hata raporu oluştururken, lütfen mümkün olduğunca fazla ayrıntı ekleyin. Gerekli şablonu doldurun, bu sorunları daha hızlı çözmemize yardımcı olacaktır.

-   **Sorunu tanımlamak için açık ve tanımlayıcı bir başlık**.
-   **Davranışı yeniden üretmek için adımlar**.
-   **Beklenen davranış**: Ne olmasını beklediğiniz.
-   **Gerçekleşen davranış**: Gerçekte ne olduğu.
-   **Ekran görüntüleri veya videolar** görsel hatalar için son derece yararlıdır.
-   **Sistem bilgileri**:
    -   İşletim Sistemi (örn., Windows 11, macOS Sonoma)
    -   Pose Nudge Sürümü (örn., v1.0.0)

---

## 🚀 Geliştirme Önerileri

Pose Nudge'ı geliştirmek için fikirlerinizi duymak isteriz! Yeni bir özellik veya geliştirme için bir fikriniz varsa, lütfen bir issue oluşturun.

-   **Açık ve tanımlayıcı bir başlık** kullanın.
-   **Önerilen geliştirmenin adım adım açıklamasını** mümkün olduğunca ayrıntılı bir şekilde sunun.
-   **Bu geliştirmenin neden çoğu Pose Nudge kullanıcısı için yararlı olacağını açıklayın**.
-   **Alternatifler düşündüyseniz**, bunların ne olduğunu bize bildirin.

---

## 💻 İlk Kod Katkınız

Katkıda bulunmaya nereden başlayacağınızdan emin değil misiniz? Bu `good first issue` ve `help wanted` etiketli sorunlara bakarak başlayabilirsiniz:

-   **Good first issue** - yalnızca birkaç satır kod ve bir veya iki test gerektirmesi gereken sorunlar.
-   **Help wanted** - `good first issue` sorunlarından biraz daha karmaşık olması gereken sorunlar.

### Geliştirme Ortamı Kurulumu

1.  **Depoyu Fork Edin ve Klonlayın**
    -   Bu depoyu kendi GitHub hesabınıza fork edin.
    -   Fork ettiğiniz depoyu yerel makinenize klonlayın:
      ```bash
      git clone https://github.com/KULLANICI_ADINIZ/pose-nudge.git
      cd pose-nudge
      ```

2.  **`upstream` Remote'u Ekleyin**
    -   Fork'unuzu senkronize tutmak için orijinal depoyu `upstream` adında bir remote olarak ekleyin.
      ```bash
      git remote add upstream https://github.com/dduldduck/pose-nudge.git
      ```

3.  **Bağımlılıkları Yükleyin ve Kurulum Yapın**
    -   Tüm gerekli paketleri yükleyin ve ortamı kurun.
      ```bash
      # Node.js bağımlılıklarını yükleyin
      npm install
      ```

4.  **Uygulamayı Geliştirme Modunda Çalıştırın**
    -   Bu, geliştirme sunucusunu başlatacaktır.
      ```bash
      npm run tauri dev
      ```

---

## 🔃 Pull Request Süreci

1.  **Yeni Bir Dal Oluşturun**
    -   Herhangi bir değişiklik yapmadan önce, `main` dalından yeni bir dal oluşturun.
      ```bash
      # Hata düzeltmesi için
      git checkout -b fix/hata-aciklamasi

      # Yeni özellik için
      git checkout -b feat/ozellik-aciklamasi
      ```

2.  **Değişikliklerinizi Yapın**
    -   Şimdi kodda değişikliklerinizi yapabilirsiniz.

3.  **Değişikliklerinizi Commit Edin**
    -   [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) spesifikasyonunu takip ediyoruz. Bu, otomatik değişiklik günlükleri oluşturmaya yardımcı olur.
        -   `feat`: Yeni bir özellik.
        -   `fix`: Bir hata düzeltmesi.
        -   `docs`: Yalnızca dokümantasyon değişiklikleri.
        -   `style`: Kodun anlamını etkilemeyen değişiklikler (boşluk, biçimlendirme vb.).
        -   `refactor`: Ne hata düzeltmesi ne de özellik eklemeyen bir kod değişikliği.
        -   `test`: Eksik testlerin eklenmesi veya mevcut testlerin düzeltilmesi.

      **Örnek:** `fix: Web kamerası kullanılamadığında çökmeyi önle`

4.  **Fork'unuza Push Edin**
    -   Değişikliklerinizi fork ettiğiniz depoya push edin.
      ```bash
      git push origin fix/dal-adiniz
      ```

5.  **Pull Request Açın**
    -   GitHub'daki deponuza gidin ve "Compare & pull request" düğmesine tıklayın.
    -   PR şablonunu doldurun.
        -   PR'ınızın çözdüğü sorunu bağlayın (örn., `Closes #123`).
        -   Değişikliklerin ayrıntılı bir açıklamasını sağlayın.

PR'ınız gönderildikten sonra, bir proje sorumlusu kodunuzu inceleyecek ve geri bildirim sağlayacaktır. Tüm geri bildirimler ele alındığında, katkınız birleştirilecektir. Sıkı çalışmanız için teşekkür ederiz!

---

## 📋 Kod Standartları

### Commit Mesajları

Commit mesajları için [Conventional Commits](https://www.conventionalcommits.org/tr/v1.0.0/) formatını takip ediyoruz:

| Tip | Açıklama |
|-----|----------|
| `feat` | Yeni özellik ekleme |
| `fix` | Hata düzeltme |
| `docs` | Dokümantasyon değişiklikleri |
| `style` | Kod formatı değişiklikleri (mantık değişikliği yok) |
| `refactor` | Kod yeniden düzenlemesi |
| `test` | Test ekleme veya düzeltme |
| `chore` | Bakım işleri |

### Kod Stili

-   TypeScript için ESLint ve Prettier kullanıyoruz
-   Rust için `cargo fmt` ve `cargo clippy` kullanıyoruz
-   Değişiklik yapmadan önce linter'ları çalıştırın

---

## 🆘 Yardım mı Lazım?

Herhangi bir sorunuz varsa veya sıkıştıysanız:

1.  [Mevcut issues](https://github.com/dduldduck/pose-nudge/issues)'ları kontrol edin
2.  [Discussions](https://github.com/dduldduck/pose-nudge/discussions) bölümünde soru sorun
3.  Yeni bir issue açın

Katkınız için tekrar teşekkür ederiz! 🎉
