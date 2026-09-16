> [!IMPORTANT]
> **Ta projekt je lastniški z odprtim vpogledom v kodo (Source-Available).** Koda je prosto dostopna za ogled, učenje in osebno/interno uporabo pod pogoji licence **PolyForm Noncommercial 1.0.0** z dodatnimi omejitvami s strani **Računkomat**. Vse avtorske in lastniške pravice so pridržane. Podrobnosti v datoteki [LICENSE](LICENSE).
>
> **This project is a source-available proprietary application.** The code is publicly accessible for viewing, learning, and personal/internal use under the terms of the **PolyForm Noncommercial 1.0.0** license with additional restrictions by **Računkomat**. All rights are reserved by the author. See [LICENSE](LICENSE) for details.

# Računkomat: Profesionalna PWA aplikacija za izdajanje računov

**Računkomat** je napredna statična spletna aplikacija, zasnovana kot PWA (Progressive Web App), kar pomeni, da deluje popolnoma offline in lokalno. Zgrajena je izključno z uporabo Vanilla HTML, CSS in Javascripta z osredotočenostjo na brezhibno hitrost in varnost, namenjena slovenskim malim podjetjem in samostojnim podjetnikom.

[English Description below](#english-version)

---

## Ključne funkcije

- **Popolna PWA (offline-first)**: Aplikacija po prvem nalaganju deluje tudi brez interneta. Podatki se shranjujejo izključno lokalno prek `IndexedDB` z uporabo `StorageManager.js`.
- **Vrhunski Design in UX**: Čista "Vanilla" CSS arhitektura z uporabo @layer plasti in nativnega gnezdenja.
- **Hitrost in zmogljivost**: Centralizirano stanje preko `Proxy` vzorca (`store.js`) in efektivna rekuperacija elementov.
- **Background PDF renderiranje**: Generiranje PDF računov poteka v ozadju prek tehnologije *Web Workers* (`PdfWorker.js`), tako da se uporabniški vmesnik nikoli ne zatakne.
- **Skrben izračun centov (Cents-based math)**: Vse monetarne vrednosti so pred izračunom pretvorjene v cente, kar eliminira Floating-point napake (v JavaScriptu znano kot `0.1 + 0.2`).
- **100 % Zasebnost**: Noben vaš podjetniški ali finančni podatek ne zapusti vaše naprave.

## Namestitev in uporaba

Ker gre za PWA aplikacijo brez zalednega sistema (backend or build process), jo zaženete izjemno hitro:

1. Klonirajte ali prenesite repozitorij.
2. Vstavite datoteke na poljuben statičen strežnik (npr. GitHub Pages, Vercel, Netlify) ali lokalno:
```bash
npx serve .
```
3. Odprite v brskalniku in jo lahko celo "Namestite" na svoje namizje ali mobilno napravo!

---

## Izjava o zasebnosti / Privacy Statement

Ta aplikacija deluje **v celoti v vašem brskalniku**. Uporablja izključno `IndexedDB` za shranjevanje finančnih podatkov (računi, stranke, podjetja) lokalno na vaši napravi. Nobeni osebni ali finančni podatki se ne prenašajo po omrežju. Brez analitike, brez sledenja, brez oblačne sinhronizacije.

This application runs entirely in your browser. It uses `IndexedDB` exclusively to store financial data (invoices, partners, companies) on your device. No personal or financial data is transmitted over the network. No analytics, no tracking, no cloud sync.

---

<a name="english-version"></a>
# English Version

**Računkomat** is a highly optimized, source-available Progressive Web App (PWA) designed for creating and managing invoices in Slovenia. It relies on a strictly "Vanilla" web stack to ensure lightning-fast performance without framework bloat.

### Key Features
- **True Offline PWA**: Built with Service Workers and an `IndexedDB`-backed State Manager to work fully offline. 
- **Web Workers PDF Generation**: Offloads heavy PDF generation to background threads, keeping the UI at 60fps.
- **Privacy First**: All user and financial data is kept exclusively on-device. No telemetry, no cloud syncs.
- **Zero-Dependency Architecture**: Uses pure HTML, CSS nesting, and ES6 module patterns for longevity and stability.

## Prispevanje / Contributing

Prispevki so dobrodošli! Če želite prispevati k projektu, predlagati izboljšave ali prijaviti hrošče, prosimo odprite Pull Request ali Issue. Z oddajo prispevka se strinjate, da se avtorske pravice prenesejo na avtorja projekta.

Contributions are welcome! If you want to contribute to the project, suggest improvements, or report bugs, please open a Pull Request or an Issue. By submitting a contribution, you agree to assign copyright to the project owner.

## Licenca / License

© 2026 **Računkomat (Avtor: Miha Knific)**. Vse pravice pridržane.

Ta projekt je **lastniški z javno dostopno kodo** (Source-Available). Koda je na voljo za ogled, učenje in nekomercialno uporabo pod pogoji licence [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) z dodatnimi omejitvami. Za podrobnosti glej [LICENSE](LICENSE).

This project is **source-available and proprietary**. The code is accessible for viewing, learning, and noncommercial use under the terms of the [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) license with additional restrictions. See [LICENSE](LICENSE) for details.
