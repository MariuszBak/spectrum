KOMPILACJA 26.10.3

SPECTRUM — PWA

INSTALACJA NA IPHONIE
1. Otwórz aplikację w Safari:
   https://spectrum-audio-iphone-k7m2.basicshore128.chatgpt.site
2. Udostępnij → Do ekranu początkowego.
3. Włącz „Otwórz jako aplikację”, jeśli opcja jest widoczna, i wybierz Dodaj.
4. Uruchom SPECTRUM z nowej ikony. Zezwól na mikrofon po naciśnięciu Start.

WŁASNY HOSTING
Rozpakuj tę paczkę i umieść całą jej zawartość na serwerze HTTPS.
Zachowaj katalog icons i wszystkie pliki. Działa również w podkatalogu.
Nie uruchamiaj przez dwukrotne kliknięcie index.html — mikrofon, instalacja
i service worker wymagają odpowiedniego środowiska HTTPS (lokalnie localhost).

OFFLINE
Pierwsze uruchomienie wymaga połączenia. W Ustawieniach poczekaj na komunikat
„Gotowa do pracy offline”. Następnie aplikacja korzysta z zapisanych plików.
Przeglądarka może usunąć pamięć offline, np. po wyczyszczeniu danych witryny.
Nowa wersja zacznie działać po zamknięciu wszystkich okien starej wersji.
Każda kompilacja ma wersję RR.M.N (rok, miesiąc, numer wydania).
Aktualny numer znajduje się w Ustawieniach oraz version.json.
Przy ręcznej zmianie plików zwiększ wersję CACHE_NAME w sw.js
i wersje zasobów w odnośnikach. W repozytorium robi to scripts/version.mjs.

FUNKCJE
Spectrum: FFT 16384, wybór 1/2/3 pików, kolory i podejrzenie wzbudzenia.
Waterfall: bieżące widmo u góry i historia poniżej, bez detekcji pików.
Poziom: RMS, chwilowy PEAK, MAX PEAK, MAX RMS.
Ustawienia: wskazówka/bargraf, dBFS/dB SPL/dBm, kalibracja.
Analizator: dolny poziom skali od -120 do -40 dBFS, zakres od–do w Hz.
Zakres częstotliwości dotyczy wykresu, Waterfall i wykrywania pików.
Zmiana pasma czyści historię Waterfall; zmiana poziomu zmienia kolory historii.
Stop wyłącza mikrofon i zachowuje odczyty. Dźwięk jest analizowany lokalnie.
„Wzbudzenie?” to heurystyka; instrumenty i inne stabilne tony mogą ją uruchomić.
dB SPL wymaga kalibracji. dBm wymaga znanego elektrycznego poziomu odniesienia.

IKONY
icons/icon-1024.png — ikona w dużej rozdzielczości.
Pozostałe wersje są przygotowane dla manifestu PWA i ekranu iPhone’a.

AUTOR
Mariusz Bak
dev@mariuszbak.eu
