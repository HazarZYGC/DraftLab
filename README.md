# DraftLab — Yahoo NBA Fantasy Assistant

Sade bir ilk sürüm: Yahoo NBA Fantasy verisini yeniler, oyuncuları **Points League** formatında sıralar ve canlı serpentine draft sırasında sıradaki mantıklı seçimi gösterir. Harici Python paketi gerektirmez.

## Çalıştırma

```bash
cd FantasyLeague
python3 server.py
```

Ardından `https://localhost:8000` adresini aç. Yerel geliştirme sertifikası self-signed olduğu için tarayıcı ilk açılışta güvenlik uyarısı gösterebilir. Yahoo bağlantısı olmadan uygulama demo modunda çalışır; draft akışını deneyebilirsin.

## Yahoo hesabını bağlama

1. [Yahoo Developer Network](https://developer.yahoo.com/apps/) üzerinden bir uygulama oluştur ve Fantasy Sports erişimini seç.
2. Callback URL olarak `https://localhost:8000/auth/yahoo/callback` gir.
3. `.env.example` dosyasını `.env` adıyla kopyala ve `YAHOO_CLIENT_ID` ile `YAHOO_CLIENT_SECRET` değerlerini doldur.
4. Sunucuyu yeniden başlat. Ana sayfada görünen **Yahoo hesabını bağla** bağlantısına bas.

Access token yaklaşık bir saatliktir. Uygulama refresh token'ı `.data/yahoo_tokens.json` içinde yalnızca yerel makinede saklar ve gerektiğinde otomatik yeniler. Bu yüzden haftalar sonra sayfayı açtığında da yeniden veri çekebilir. `.env` ve `.data` git'e dahil edilmez.

## İlk algoritma

Sezon başlamadan önce iki tamamlanmış sezon kullanılır. Uygulama sistem tarihine göre sezonları kendisi bulur; örneğin Eylül 2026'da 2025 ve 2024 Yahoo NBA sezonlarını çeker. Oyuncular sezonlar arasında Yahoo `player_id` ile eşleştirilir:

- son tamamlanmış sezon: `%65`
- bir önceki sezon: `%35`
- son iki sezondaki maç kaçırma sıklığı `1 − ağırlıklı oynanan maç / 82` olarak hesaplanır
- risk indirimi `1 − 0.35 × maç kaçırma oranı` formülüdür; örneğin maçların `%30`unu kaçıran oyuncunun draft değeri `%10.5` düşer
- güncel OUT/INJ durumunda ayrıca `%10`, day-to-day/questionable durumunda `%4` indirim uygulanır

Yahoo varsayılan puan formülü: `PTS + 1.2×REB + 1.5×AST + 3×STL + 3×BLK − TO`. Üçlük için ayrıca puan verilmez.

Yahoo ligindeki gerçek scoring katsayılarını netleştirdiğimizde bu sabitleri `ranking.py` içindeki `POINT_WEIGHTS` bölümünde güncelleyeceğiz. Çaylakların geçmiş sezon verisi olmadığı için projeksiyon kaynağı eklenene kadar otomatik sıralamada temkinli ele alınmaları gerekir.

### Alternatif kategori modeli

Kategori ligi için dokuz standart kategori kullanılıyor: FG%, FT%, 3PM, PTS, REB, AST, STL, BLK ve TO. Her oyuncunun lig havuzuna göre z-score'u hesaplanır. Turnover ters işaretlidir; yüzde kategorileri deneme hacmine göre ağırlıklandırılır. OUT/INJ durumuna `-1.60`, day-to-day/questionable durumuna `-0.55` risk cezası uygulanır.

Draft önerisi bu temel değere küçük ve anlaşılır ekler yapar:

- 3. turdan sonra kadroda hiç olmayan bir mevkiyi kapatıyorsa `+0.35`
- Birden fazla Yahoo mevki uygunluğu varsa `+0.15`
- Aktif/düşük riskliyse `+0.12`

Arayüzde karşılaştırma amacıyla 9-Cat seçeneği de bırakıldı; ana ve varsayılan model Points League'dir.

## Draft kullanımı

Takım sayısı ve tur sayısını girince katılımcılar arasında `Sen` rastgele bir yere yerleşir. Sıra serpentine ilerler. Gerçek draftta kim kimi aldıysa oyuncu kartına tıkla; uygulama onu mevcut sıradaki takıma yazar, havuzdan çıkarır ve öneriyi günceller. Draft tarayıcıda saklandığı için sayfa yenilenince kaybolmaz.

## Kontrol

```bash
python3 -m unittest discover -s tests -v
```

Demo istatistikleri yalnızca arayüzü deneyebilmek içindir ve canlı veri iddiası taşımaz. Yahoo bağlandığında sayfa açılışında ve yenile düğmesinde son iki tamamlanmış sezon yeniden çekilir.
