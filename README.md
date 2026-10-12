# salvo

`npm publish`'ten önce, yayınlanacak paketin gerçekten söylediği şey olduğunu
doğrular. Bir kez çalıştırılır, sorun varsa sıfırdan farklı çıkar.

## Neden

`bukalemun@1.5.0` npm'e 14:28'de çıktı. `bk.version`'ı sabit koddan kurtaran
commit 14:46'da girdi. Aradaki 18 dakika yüzünden yayınlanan pakette çalışma
zamanı hâlâ `1.3.2` diyordu — yani **1.5.0'ın düzelttiğini iddia ettiği hatayı
1.5.0 taşıyordu**. Testler yeşildi, çünkü testler çalışma ağacını denetliyordu;
tarball'ın içine kimse bakmamıştı.

`prepublishOnly` de kurtarmadı: derleme yapıyordu ama sonucu commit'lenmiş
`dist/` ile karşılaştıran bir şey yoktu.

salvo tam olarak buna bakar: **HEAD'in temiz bir kopyasından derlenen çıktı,
paketle gönderilecek çıktıyla aynı mı?**

## Kontroller

| Kontrol | Yakaladığı |
|---|---|
| `build-drift` | Commit'li çıktı, HEAD'den yapılan derlemeyle ayrışmış (bukalemun 1.5.0) |
| `version-echo` | Paketin içindeki sürüm bildirimleri package.json ile uyuşmuyor |
| `git-state` | Yayınlanan ağaç commit'lenmemiş ya da pushlanmamış |
| `entrypoints` | `main`/`module`/`types`/`exports` var olmayan dosyayı gösteriyor |
| `declared-files` | `files` listesindeki dosya/dizin artık yok — npm onu sessizce atlar |
| `secrets` | Tarball'a `.env`, anahtar, `.npmrc` gibi bir şey girmiş |
| `tag-match` | `package.json` sürümüyle git etiketi ayrışmış |

## Kullanım

```sh
npx salvo            # yayınlanacak paketi denetle
npx salvo --json     # makine okunur çıktı
npx salvo --skip build-drift   # derlemesi pahalı paketlerde
```

## GitHub Action olarak

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }     # build-drift `git archive HEAD` çalıştırır
- run: npx salvo
```

## Kanıt

Bukalemun'un npm'e kırık giden commit'i (`f058fce`) ve düzeltilmiş hâli
(`decfe18`) üzerinde:

```
$ salvo /tmp/bukalemun@f058fce
  ✗ version-echo  dist/bukalemun.cjs içinde sürüm "1.3.2" yazıyor, package.json "1.5.0" diyor.
  ✗ version-echo  dist/bukalemun.esm.js içinde sürüm "1.3.2" yazıyor…
  … (6 engel)
  6 engel, 1 uyarı — yayınlama.                                  → çıkış 1

$ salvo /tmp/bukalemun@decfe18
  temiz — paket söylediği şey.                                   → çıkış 0
```

## Testler

```sh
npm test
```

14 test. `build-drift` testleri gerçek bir git deposu kurup gerçekten derliyor;
sahte dosya sistemiyle geçen bir test, aracın tek işini denemiyor demektir.
