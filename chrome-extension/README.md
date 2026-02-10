# Chrome Extension (Kaesra Agent Bridge)

Bu klasor Chrome eklentisidir. Eklenti, `kaesra-agent` bridge server'ina baglanir.

## Kurulum

1. Agent bridge'i baslat:

```bash
npm run bridge
```

2. Chrome'da `chrome://extensions` ac.
3. `Developer mode` ac.
4. `Load unpacked` ile bu `chrome-extension/` klasorunu sec.
5. Eklenti popup'inda bridge URL'yi kontrol et (`http://127.0.0.1:3434`).

## Ozellikler

- Chat bar uzerinden ajana prompt gonderme
- Aktif sekmeyi ozettirme
- Zamanli gorev olusturma/listeleme/calistirma
- Bilgisayardaki programlari listeleme
- Program acma (isim veya secili listeden)
- Bridge komut kuyrugu ile CLI/AI tarafindan sekme yonetimi
- Her Chrome komutunda izin penceresi (izin ver, reddet, bir daha sorma)

## Chrome Komut Kanali

Bu extension arka planda `/chrome/poll` endpoint'ini dinler ve gelen komutlari calistirir.
Komut calismadan once izin penceresi acilir. \"Bir daha sorma\" secersen aksiyon icin kural kaydedilir.

Ornek CLI:

```bash
node src/index.js chrome navigate https://example.com
node src/index.js chrome send getActiveTab
node src/index.js chrome send fillSelector --input '{"selector":"input[name=q]","value":"agent test"}'
```

## Not

- Bridge tarafinda `BRIDGE_API_TOKEN` ayarlarsan popup'ta ayni token'i gir.
- Masaustu shell komutu varsayilan olarak kapali (`DESKTOP_ALLOW_SHELL=false`).
