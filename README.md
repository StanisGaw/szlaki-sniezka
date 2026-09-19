# Szlaki na Śnieżkę

Mapa szlaków turystycznych na Śnieżkę i w jej okolicy (Karkonosze, strona polska i czeska).
Aplikacja jest statyczna — sam HTML, CSS i JavaScript, bez backendu i bez kluczy API.

## Funkcje

- mapa oparta o darmowe warstwy **OpenTopoMap** i **OpenStreetMap** (Leaflet),
- **57 szlaków** w promieniu 6 km od szczytu, pobranych z OpenStreetMap,
- filtrowanie po **kolorze szlaku**, wyszukiwarka po nazwie i po miejscowościach,
- **geolokalizacja**: pokazanie swojej pozycji, dystans do każdego szlaku i filtr „tylko w pobliżu mnie (5 km)”,
- **śledzenie pozycji** z kierunkiem (kompas telefonu lub kurs z GPS), mapa podąża za użytkownikiem,
- **PWA działająca offline**: po dodaniu do ekranu głównego aplikacja, szlaki i Leaflet są w cache;
  przycisk „Pobierz mapę offline” zapisuje 407 kafelków (zoom 11–15) dla okolicy Śnieżki,
  a kafelki oglądane online zapamiętują się same (do 3000),
- widok listy i mapy, działa na telefonie, obsługuje tryb ciemny.

## Instalacja na telefonie

1. Otwórz https://stanisgaw.github.io/szlaki-sniezka/ w Safari (iPhone) lub Chrome (Android).
2. iPhone: Udostępnij → „Do ekranu początkowego”. Android: menu ⋮ → „Dodaj do ekranu głównego” / „Zainstaluj”.
3. Jeszcze z internetem kliknij **Pobierz mapę offline** — potem mapa działa bez zasięgu.

Po zmianie plików aplikacji podbij `VERSION` w `sw.js`, żeby telefony pobrały nową wersję.

## Uruchomienie lokalnie

Dane wczytywane są przez `fetch`, więc potrzebny jest lokalny serwer:

```bash
python3 -m http.server 8000
```

Potem otwórz http://localhost:8000.

## Dane

`trails.json` powstał z zapytania do Overpass API o relacje `route=hiking`
w prostokącie 50.68–50.78 N, 15.63–15.82 E, zawężone do tras przebiegających
w promieniu 6 km od szczytu Śnieżki (50.73611, 15.73972).

Kolor szlaku pochodzi z tagu `osmc:symbol` lub `kct_*`. Podana długość dotyczy
całej trasy w OpenStreetMap, także poza obszarem mapy — dlatego np. Główny Szlak
Sudecki ma ponad 400 km.

Żeby odświeżyć dane, uruchom ponownie zapytanie z `scripts/fetch-trails.sh`.

## Licencje

- dane szlaków: © współtwórcy OpenStreetMap, [ODbL](https://www.openstreetmap.org/copyright),
- kafelki map: OpenStreetMap oraz OpenTopoMap (CC-BY-SA),
- kod: MIT.
