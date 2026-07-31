# ChessPrep — Documento Técnico de Diseño (Web)

**Fecha:** 31 de julio de 2026  
**Producto:** aplicación web (navegador). Sin APIs de IA generativa. Sin empaquetado nativo (Capacitor / tiendas) en el alcance actual.

---

## 1. Resumen del proyecto

ChessPrep es una **aplicación web de preparación ajedrecística** con dos funciones principales:

1. **Visor de partidas paso a paso** — abrir una partida del rival y recorrerla jugada a jugada sobre un tablero interactivo.
2. **Estadísticas del jugador** — ver datos agregados y objetivos sobre su juego (rendimiento con blancas/negras, aperturas, piezas relevantes, etc.), siempre trazables a un conjunto concreto de partidas.

El flujo típico: buscar un rival → ingerir/consultar sus partidas públicas → explorar estadísticas o abrir una partida y avanzar/retroceder en el tablero.

No hay redacción automática de informes ni llamadas a modelos de lenguaje. Toda la información que ve el usuario sale de datos de partidas (PGN) y de cálculos deterministas en el backend.

Principios de diseño:

- **Dos pilares de producto.** Cualquier pantalla o endpoint debe servir al visor o a las estadísticas (o a ambas: p. ej. “abrir partidas de esta apertura”).
- **Nunca inventar datos.** Todo número mostrado debe ser trazable a una fuente y a un conjunto de partidas concreto.
- **Multi-fuente por diseño.** Ninguna fuente externa es obligatoria; el sistema degrada si una falla o no existe.
- **Separación online / OTB / combinado.** Estadísticas y listados de partidas se pueden acotar por tipo.
- **Sin IA generativa.** No hay LLM ni APIs de IA. El motor de ajedrez (Stockfish), si se usa, es evaluación numérica opcional sobre posiciones, no generación de texto.
- **Web-first.** UI en el navegador; lógica pesada (ingesta, agregaciones, evaluación) en el backend.

---

## 2. Funciones principales

### 2.1 Visor de partidas paso a paso

Objetivo: estudiar cómo juega el rival en partidas concretas.

| Capacidad | Detalle |
|---|---|
| Lista de partidas | Filtrable por color, apertura/ECO, resultado, fecha, modo (online/OTB/combinado), rival |
| Navegación jugada a jugada | Avanzar / retroceder / ir a jugada N; teclado y controles en pantalla |
| Tablero interactivo | `react-chessboard` + `chess.js` (o equivalente); FEN/PGN desde la API |
| Metadatos | Evento, fecha, resultado, ECO, fuente, Elo si existe |
| Enlace desde stats | Desde una apertura o un filtro estadístico, saltar a las partidas que lo componen |
| Evaluación de motor (opcional, v1.x) | Barra de evaluación / marcas de error vía Stockfish en servidor; no bloquea el MVP del visor |

El MVP del visor es **reproducir el PGN paso a paso**. Stockfish es una mejora posterior sobre la misma pantalla.

### 2.2 Estadísticas del jugador

Objetivo: preparar el enfrentamiento con números claros, sin texto generado.

Ejemplos de métricas (todas calculadas a partir de partidas etiquetadas):

| Área | Ejemplos |
|---|---|
| Color | % victoria / tablas / derrota con **blancas** vs **negras**; Elo medio de rivales por color |
| Aperturas | Repertorio por ECO/nombre, frecuencia, score por apertura y por color; líneas más jugadas |
| Resultado y ritmo | Score global, por control de tiempo (si hay dato), por periodo |
| Piezas | **Piezas más relevantes** del jugador: p. ej. qué pieza mueve más en medio juego, qué piezas suelen estar presentes en finales ganados/perdidos, actividad relativa (movimientos por tipo de pieza), piezas que más participan en capturas — métricas derivadas del PGN, no opiniones |
| Fase de partida | Longitud media de partida, resultados según partidas largas vs cortas (proxy de finales) |
| Muestra | Nº de partidas usadas, fuentes, rango de fechas, desglose online vs OTB |

Reglas de presentación:

- Cada bloque de stats declara **n**, rango temporal y modo (`online` / `otb` / `combined`).
- Si la muestra es pequeña, se muestra el número; no se inventan conclusiones en prosa.
- Las stats son el producto; no hay “informe IA” encima.

---

## 3. Stack tecnológico

| Capa | Elección | Motivo |
|---|---|---|
| Frontend web | **Next.js (App Router) + React + TypeScript + Tailwind CSS** | Rutas por jugador/partida, SSR opcional, ecosistema maduro para tableros (`react-chessboard`, `chess.js`) |
| Backend API | **FastAPI (Python)** | Ingesta PGN, agregaciones estadísticas y (opcional) Stockfish; ecosistema `python-chess` |
| Parsing PGN / lógica ajedrez | **python-chess** (servidor) + **chess.js** (cliente, visor) | Servidor normaliza y calcula stats; cliente anima el tablero jugada a jugada |
| Motor de evaluación (opcional) | **Stockfish** self-hosted vía UCI | Solo para overlay de evaluación en el visor / métricas de calidad; no es requisito del MVP |
| Base de datos | **PostgreSQL** | Jugadores, partidas, aperturas, agregados; JSONB donde haga falta |
| Cache / colas | **Redis** + **Celery** (o RQ en prototipo) | Cache de proveedores; jobs de ingesta y de recálculo de stats |
| Búsqueda | **PostgreSQL full-text / `pg_trgm`** | Nombre / apellidos / país en v1 |
| Auth (web) | Cookie HTTP-only + CSRF (o JWT en cookie) | Pensado para navegador |
| Progreso async | **SSE** o polling | Ingesta / recálculo de stats (“partidas importadas…”) |
| Infra | **Docker Compose** en dev; servicios separados en prod | Frontend, API, workers, Postgres, Redis |

**Fuera de alcance:** APIs de IA generativa (Claude, OpenAI, etc.), apps nativas / Capacitor / tiendas. PWA opcional más adelante sobre el mismo Next.js.

---

## 4. Arquitectura general

```
┌──────────────────────────────────────────┐
│  NAVEGADOR                               │
│  Next.js                                 │
│  · Buscador / ficha de jugador           │
│  · ESTADÍSTICAS (color, aperturas, …)    │
│  · VISOR (partida paso a paso)           │
│  · Selector modo online/OTB/combinado    │
└──────────────────┬───────────────────────┘
                   │ HTTPS (REST + SSE)
┌──────────────────▼───────────────────────┐
│              API (FastAPI)                 │
│     Auth · Rate limit · Orquestación       │
└──┬──────────────────┬──────────┬─────────┘
   │                  │          │
┌──▼──────────┐  ┌────▼────┐  ┌──▼───────────┐
│ Motor de    │  │ Workers │  │ Importadores │
│ Estadísticas│  │(+ SF    │  │ PGN          │
│ (agregados) │  │ opcional)│  │              │
└──┬──────────┘  └───┬─────┘  └──┬───────────┘
   │                 │           │
┌──▼─────────────────▼───────────▼───────────┐
│           CAPA DE PROVEEDORES                │
│  Online: Lichess · Chess.com                 │
│  OTB: Gigabase · TWIC · fallbacks · PGN      │
└──────────────────┬───────────────────────────┘
                   │
            ┌──────▼──────┐
            │ PostgreSQL  │
            │ + Redis     │
            └─────────────┘
```

**Contrato de fronteras:**

- El navegador reproduce partidas y pinta gráficos; no parsea dumps masivos ni ejecuta Stockfish en el flujo principal.
- Stats y listados de partidas salen de la API; el visor pide el PGN (o la lista de FENs/jugadas) de una `Game`.
- Sin componente “Motor IA” ni cola de redacción de informes.

---

## 5. Capa de proveedores — patrón central

Interfaz común:

```python
class GameProvider(Protocol):
    name: str
    game_type: Literal["online", "otb"]
    reliability: Literal["official", "community", "user_upload"]

    def search_player(self, query: PlayerQuery) -> list[PlayerCandidate]: ...
    def fetch_games(self, player_id: PlayerRef, since: date | None) -> list[RawGame]: ...
    def is_available(self) -> bool: ...
```

Modelo común (`RawGame`):

```python
class RawGame(BaseModel):
    source: str
    game_type: Literal["online", "otb"]
    source_confidence: Literal["official", "community", "user_upload"]
    pgn: str
    white: PlayerRef
    black: PlayerRef
    result: Literal["1-0", "0-1", "1/2-1/2", "*"]
    date: date | None
    event: str | None
    eco: str | None
    time_control: str | None
    fetched_at: datetime
```

**Deduplicación:** hash normalizado sobre (jugadores, fecha, resultado, primeros N movimientos).

### 5.1 Proveedores

**Online:** Lichess API · Chess.com API  

**OTB:** Lumbra's Gigabase (bulk principal) · TWIC (actualidad) · YottaChess / 365chess / chessgames (fallback por nombre; scraping — revisar ToS) · Caissabase · chess-results (identidad, sin PGN) · FIDE (metadatos) · importación manual PGN desde el navegador  

**Orden de prioridad:** Gigabase → TWIC → Lichess/Chess.com → fallbacks web → PGN manual.

Los proveedores OTB sin API pública se tratan como fallback de baja frecuencia, no como sync masivo.

---

## 6. Modelo de datos

- **Player** — id, fide_id, nombre, federación, título, elos, etc.
- **PlayerAlias** — variantes de nombre por fuente (sin fusionar perfiles a ciegas).
- **Game** — desde `RawGame`; FK a jugadores, torneo, apertura; `game_type`; PGN (o moves normalizados).
- **Tournament** — nombre, fechas, formato, fuente.
- **Opening** — ECO, nombre, variante.
- **PlayerStatsSnapshot** (opcional) — agregados materializados por (jugador, mode, ventana temporal) para no recalcular en cada request; invalidar al ingerir partidas nuevas.
- **EngineEvaluation** (opcional, post-MVP) — evaluación por jugada si se activa Stockfish.
- **User** — cuenta web (login, preferencias); distinto de `Player`.

No hay entidad de “informe generado por IA”.

---

## 7. Modos: online / OTB / combinado

Filtro sobre datos ya etiquetados en la ingesta (`game_type` del proveedor).

```
GET /api/v1/players/{id}/stats?mode=online|otb|combined
GET /api/v1/players/{id}/openings?mode=...&color=white|black
GET /api/v1/players/{id}/games?mode=...
```

Por defecto: **combinado**, indicando siempre cuántas partidas de cada tipo entran en el cálculo.  
En la UI: selector de 3 estados en ficha de jugador, panel de stats y listado/visor.

---

## 8. Motor de estadísticas

Cálculos deterministas sobre el conjunto filtrado de `Game` (pandas o SQL agregado). Alimenta la función 2 del producto.

### 8.1 Agregados prioritarios (MVP)

1. **Por color:** partidas, score, % W/D/L con blancas y con negras.
2. **Por apertura:** top ECO/nombres, frecuencia, score, desglose por color.
3. **Lista enlazable:** cada celda/stats debe poder abrir el listado de partidas subyacente → visor.
4. **Piezas (v1):** a partir del PGN parseado, métricas simples por tipo de pieza del jugador (frecuencia de movimientos, capturas realizadas/sufridas, presencia en el último tercio de la partida). Refinar definición en implementación; siempre con `n` visible.

### 8.2 Stockfish (post-MVP, opcional)

Solo si se quiere calidad de jugada en el visor o métricas de “errores por fase”:

- Worker UCI → `EngineEvaluation` por partida.
- Progreso vía SSE; no bloquea stats básicas ni la reproducción paso a paso.
- Sin texto generado: solo números (centipawns, clasificación de jugada).

---

## 9. Mapeo funcional → componentes

| Función / capacidad | Componente |
|---|---|
| Buscar rival | Página Next.js + `GET /players/search` + proveedores (metadatos) |
| Ingesta de partidas | Capa de proveedores + cola async |
| **Estadísticas** | Motor de Estadísticas + páginas `/players/[id]` (tabs/secciones) |
| **Visor paso a paso** | `GET /games/{id}` + React + `chess.js` + `react-chessboard` |
| De stats → partidas | Query `games?opening=…&color=…` → click → visor |
| Importación PGN | Upload web → mismo pipeline de normalización |
| Auth / preferencias | `User` + cookies de sesión |

Módulos secundarios (comparador, calculadoras Elo, dashboard) solo si no distraen de los dos pilares; no son MVP.

---

## 10. API — endpoints principales (borrador)

Prefijo: `/api/v1`.

```
# Jugador y partidas
GET  /api/v1/players/search?q=...
GET  /api/v1/players/{id}
POST /api/v1/players/{id}/refresh-games
GET  /api/v1/players/{id}/games?mode=&color=&eco=&from=&to=
GET  /api/v1/games/{id}                         # PGN + metadatos para el visor
GET  /api/v1/games/{id}/moves                   # opcional: lista de SAN/FEN precomputada

# Estadísticas
GET  /api/v1/players/{id}/stats?mode=online|otb|combined
GET  /api/v1/players/{id}/stats/by-color
GET  /api/v1/players/{id}/stats/openings?color=white|black
GET  /api/v1/players/{id}/stats/pieces          # piezas relevantes / actividad

# Jobs / utilidades
GET  /api/v1/jobs/{id}/events                   # SSE progreso ingesta
POST /api/v1/pgn/import
POST /api/v1/auth/login | logout | me

# Opcional post-MVP
GET  /api/v1/games/{id}/engine-analysis
```

CORS y cookies: orígenes explícitos; ideal mismo sitio vía reverse proxy (`/api` detrás del mismo dominio).

---

## 11. Despliegue web

```
Internet → CDN / reverse proxy (TLS)
              ├─ Next.js (UI: stats + visor)
              └─ FastAPI (/api/v1)
                     ├─ Workers (ingesta, stats; Stockfish opcional)
                     ├─ PostgreSQL
                     └─ Redis
```

| Pieza | Opciones v1 |
|---|---|
| Frontend | Vercel, Cloudflare Pages, o contenedor + Nginx/Caddy |
| API + workers | Fly.io, Railway, Render, VPS Docker |
| Postgres / Redis | Managed o contenedores locales |

Móvil: responsive; sin app store. PWA opcional más adelante.

---

## 12. Escalabilidad futura

- Más métricas de piezas / estructuras (sin IA: solo agregados sobre PGN).
- Overlay Stockfish en el visor.
- Comparador de dos jugadores reutilizando el Motor de Estadísticas.
- Export CSV/PDF de tablas de stats (plantillas, no texto generado).
- Preparación por torneo (filtro de rivales + fechas).
- PWA ligera para “añadir a inicio”.

---

## 13. Próximos pasos

1. Esquema BD con `game_type` desde el inicio.
2. Monorepo: `web/` (Next.js) + `api/` (FastAPI) + `docker-compose.yml`.
3. Ingesta piloto: **Lichess** (online) + **Gigabase o PGN de prueba** (OTB) → modelo `Game` válido.
4. **MVP UI #1 — Visor:** listado de partidas + tablero paso a paso.
5. **MVP UI #2 — Stats:** por color + aperturas + enlace a partidas filtradas.
6. Métricas de piezas sobre PGN parseado; afinar definición con datos reales.
7. Selector online/OTB/combinado en ficha y en APIs.
8. Preview desplegado (URL) para probar en desktop y móvil.
9. (Opcional) Contenedor Stockfish + overlay en el visor.

---

*Documento centrado en producto web con dos pilares (visor + estadísticas) y sin IA generativa.*
