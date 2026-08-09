# ChessPrep

Aplicación web de preparación ajedrecística para torneos. Convierte partidas públicas de Lichess y Chess.com, resultados OTB de Info64 o archivos PGN en estadísticas trazables y permite recorrer las partidas que incluyen jugadas.

## Qué incluye este MVP

- Búsqueda de usuarios exactos de Lichess y Chess.com.
- Dossier combinado para unir ambas plataformas aunque los alias sean distintos.
- Dossier de jugador con score global, forma reciente y desglose por color.
- Repertorio navegable por decisiones propias y respuestas del rival, además del resumen por ECO, apertura, color, frecuencia y score.
- Selector de ritmo `global / bullet / blitz / rápida / lenta` aplicado a partidas y estadísticas; global incluye todos los ritmos estándar.
- Solo se analizan partidas de ajedrez estándar; Chess960, pasapiezas, Crazyhouse y demás variantes se excluyen tanto desde los proveedores como al importar PGN.
- Lista de partidas con filtros por texto, color, resultado y apertura.
- Navegación desde una estadística hasta las partidas que la forman.
- Visor con posiciones FEN validadas, controles, reproducción y teclado.
- Análisis Stockfish en el cliente (Web Worker): calidad de jugadas, barra y curva de evaluación, mejor jugada, precisión, momentos clave y modo explorar.
- Búsqueda OTB por ID FIDE: ficha oficial, evolución mensual de los Elo lento, rápido y blitz durante los últimos tres años, participaciones de Info64 contrastadas por el mismo ID, rivales, resultados, rondas, fechas y balance con filtro temporal.
- Importación PGN independiente de la búsqueda de jugadores: acepta `.pgn` y `.txt`, deduplica las partidas, infiere como perspectiva del dossier el nombre más repetido y crea un dataset temporal con TTL sin exigir ID FIDE ni coincidencias con una ficha oficial.
- Ejemplo ficticio integrado para probar la interfaz y los cálculos sin red; solo se carga mediante una acción expresa y se identifica como sintético en la API y en pantalla.
- Interfaz disponible en español, inglés, alemán, francés e italiano. El selector superior aplica el idioma sin recargar, recuerda la elección en el navegador y no utiliza servicios externos de traducción.
- Calculadora FIDE con dos modos: variación de Elo entre dos jugadores usando el rating y la K de la lista mensual actual, y estimación de Elo inicial con resultados, mes/año y el rating histórico de cada rival. Ambos admiten ID FIDE o datos manuales y aplican las tablas y límites vigentes de FIDE.
- API OpenAPI documentada en `/api/docs`.
- Sin cuentas, base de datos, Redis, colas ni IA generativa.

## Arquitectura

```text
web/                              SPA responsive sin proceso de build
web/app.js                        Composición, utilidades comunes y estado compartido
web/js/*Controller.js             Controladores de dossier, visor, OTB, PGN y Elo
web/js/stockfishEngine.js         Adaptador del Worker de Stockfish
web/js/gameAnalysis.js            Orquestación del análisis de una partida
web/js/exploreMode.js             Análisis interactivo de posiciones
web/i18n.js                       Traducciones, detección y persistencia del idioma
web/vendor/                       chess.js y Stockfish WASM/JS (ver vendor/NOTICE.md)
web/licenses.html                 Licencias de terceros y descarga del código fuente de Stockfish
api/app/main.py                   Composición de proveedores y servicios concretos
api/app/app_factory.py            Construcción y configuración de FastAPI
api/app/routers/                  Adaptadores HTTP agrupados por capacidad
api/app/services/                 Casos de uso, normalización, estadísticas y TTL
api/app/providers/                Integraciones con Lichess, Chess.com, FIDE e Info64
api/app/config.py                 Configuración tipada del entorno
api/app/security.py               Límites HTTP, CORS, hosts y cabeceras defensivas
api/tests/                        Pruebas del contrato, parser e integraciones
docker-compose.yml                Servicios web y API separados
```

La dependencia fluye desde los adaptadores hacia el núcleo: las rutas HTTP llaman a servicios de aplicación y estos reciben por inyección los proveedores y el almacén temporal que necesitan. `main.py` es el único punto que conoce todas las implementaciones concretas. En el navegador, `app.js` crea los controladores de cada función y les entrega únicamente las utilidades compartidas; el dossier, el visor, la búsqueda OTB, el importador PGN y la calculadora Elo no se llaman entre sí mediante detalles internos.

### Análisis Stockfish (cliente)

El visor ocupa la pantalla completa y conserva el tablero y los controles de navegación en una zona estable. El encabezado mantiene siempre el orden convencional blancas–negras, independientemente del jugador buscado. La reproducción automática avanza cada 1,1 segundos. A la derecha, la lista de jugadas usa todo el espacio cuando Stockfish está apagado; al activar **Analizar** (tecla `A`), se divide en dos paneles independientes y desplazables para que ninguna función quede fuera de la vista. La curva de evaluación diferencia visualmente las zonas de ventaja blanca y negra mediante fondos y rellenos distintos. El análisis se ejecuta íntegramente en el navegador con **Stockfish 18 Lite**, en su compilación WebAssembly de un solo hilo y con la red NNUE ligera integrada. El Worker carga los archivos locales `/vendor/stockfish/stockfish-18-lite-single.js` y `.wasm`: no consulta un motor remoto, no exige backend adicional ni requiere cabeceras de aislamiento entre orígenes. La política CSP permite únicamente la compilación WASM local necesaria para el motor. En el panel puedes ajustar el **presupuesto por búsqueda (10k–2M nodos)** y las **líneas MultiPV (1–30)**; por defecto usa 150k nodos y 3 líneas. Un número fijo de nodos da a la jugada recomendada y a la jugada probada el mismo trabajo, con independencia de la velocidad del dispositivo. La mejor jugada siempre procede de una búsqueda de referencia de una sola línea; las MultiPV se presentan únicamente como alternativas y cada búsqueda limpia el hash para evitar que el orden de consultas cambie el resultado. El tablero es interactivo desde que se abre la partida y desde cualquier posición: basta con arrastrar una pieza —sin desplazar visualmente la casilla— o seleccionar sus casillas para probar una jugada legal. El primer movimiento manual activa el análisis automáticamente y muestra su calidad, pérdida de probabilidad de resultado y alternativa óptima. Esa valoración restringe la búsqueda a la jugada elegida desde el mismo FEN y el mismo presupuesto que la referencia. Los análisis terminados se guardan temporalmente por posición, versión del motor y presupuesto, por lo que deshacer recupera exactamente la misma recomendación sin mezclar resultados incompatibles. Se pueden encadenar jugadas, deshacerlas o volver a la línea original; esta interacción utiliza un Worker independiente para no quedar bloqueada detrás del análisis progresivo de la partida.

Stockfish.js y el motor se distribuyen bajo GPLv3. ChessPrep conserva los binarios originales de `stockfish@18.0.8`, la licencia, los avisos, los hashes y el código fuente correspondiente del commit exacto. Todo ello se publica junto al motor en `/licenses.html`; las pruebas automáticas comprueban que esos artefactos siguen disponibles y no han cambiado inadvertidamente.

El documento técnico proponía Next.js como una tecnología orientativa. Para este MVP se ha usado una SPA sin proceso de build: mantiene la separación `web/api`, reduce dependencias y permite ejecutar el producto con Python solamente. FastAPI también sirve los archivos web en desarrollo; en Docker, Nginx expone el frontend y redirige `/api` al servicio correspondiente.

### Muestras, ritmos y variantes

El dossier permanece oculto hasta que se busca un jugador, se importa un PGN o se pulsa **Ver ejemplo ficticio**. Ese ejemplo contiene 12 PGN sintéticos atribuidos únicamente a «Jugador de muestra»: sus estadísticas son cálculos reales y deterministas sobre esas partidas, pero no describen a una persona, cuenta o torneo reales.

La interfaz solicita como máximo las 100 partidas estándar más recientes de cada proveedor. El ritmo **Global** no aplica un filtro temporal; **Bullet**, **Blitz**, **Rápida** y **Lenta** muestran únicamente su categoría.

Lichess se consulta solo con sus modalidades estándar (`ultraBullet`, `bullet`, `blitz`, `rapid`, `classical` y `correspondence`). En Chess.com se aceptan exclusivamente partidas con `rules="chess"`. La misma regla se aplica a los PGN importados: se omiten Chess960, pasapiezas, Crazyhouse, atómico, antiajedrez y cualquier partida declarada como variante o con una posición inicial no estándar. Cuando el proveedor permite contabilizarlas, la respuesta incluye un aviso con el número de partidas descartadas.

Cuando un PGN no aporta `Opening` o `ECO`, ChessPrep recorre sus jugadas y busca la posición más profunda en una base local de 3.810 posiciones ECO. La coincidencia se hace por EPD, no por la secuencia literal, por lo que reconoce transposiciones; si la partida se desvía por una línea secundaria conserva la última apertura conocida. Solo permanece sin clasificar cuando ni las cabeceras ni las posiciones permiten identificarla.

El panel **Repertorio** ofrece dos vistas. **Decisiones** recorre las posiciones conocidas como un mapa: cada rama indica si la jugada que la introdujo fue del jugador o del rival, calcula su porcentaje dentro de la posición anterior y permite abrir exactamente las partidas de esa rama. Las posiciones idénticas alcanzadas por órdenes distintos se unifican. **Aperturas** conserva el resumen tradicional por ECO, nombre y color y su filtro exacto de partidas.

### Resultados OTB de Info64

La búsqueda OTB parte siempre de un ID FIDE numérico. ChessPrep obtiene primero el nombre, los tres ratings actuales y el historial mensual de los últimos tres años de la [ficha oficial de FIDE](https://ratings.fide.com/). La tarjeta verificada representa en una misma mini gráfica la evolución del Elo lento, rápido y blitz; si el historial no está disponible, la identidad y los ratings actuales siguen mostrándose con normalidad. Después busca al jugador en el [buscador público de jugadores de Info64](https://info64.org/search-player) y abre cada participación candidata. Una participación solo cuenta si su ficha de torneo enlaza exactamente al mismo ID FIDE; una coincidencia de nombre por sí sola no se acepta.

Para cada emparejamiento se muestran rival, rating e ID FIDE cuando constan, color, resultado, torneo, ronda, mesa y fecha. También se conservan los rivales sin ficha FIDE y se puede alternar entre todos, federados y no federados; aquí «federado» significa que Info64 publica un ID FIDE, aunque el jugador no tenga Elo. El buscador de rival acepta fragmentos del nombre o el ID FIDE, ignora mayúsculas y acentos, y actualiza el balance al instante sobre el grupo visible. La fecha procede del calendario de rondas de Info64; si un torneo solo publica su intervalo general, se marca con `≈` y el filtro temporal compara ese intervalo. La interfaz acepta fechas en formato español `dd/mm/aaaa` y ofrece periodos rápidos sin depender del calendario nativo del navegador.

Info64 publica resultados y estadísticas de torneos, pero no garantiza que incluya el PGN. Por eso estos resultados no abren el visor de jugadas. La disponibilidad y el histórico dependen de los torneos publicados en Info64; no es una base exhaustiva de todas las partidas OTB del jugador.

### Importación PGN independiente

El importador se encuentra en una sección propia al final de la página y no forma parte del buscador FIDE/Info64. Un archivo `.pgn` o `.txt` de hasta 5 MB puede procesarse directamente, quitarse antes de enviar y convertirse en un dossier temporal nuevo. No se solicita ID FIDE, no se compara el nombre con una ficha oficial y no se fusiona con el dossier que estuviera abierto.

Para orientar las estadísticas por color, ChessPrep toma automáticamente como jugador principal el nombre que más veces aparece entre las cabeceras `White` y `Black`; en caso de empate conserva el primero. Todas las partidas estándar válidas permanecen en el dataset, las duplicadas y variantes se omiten y los avisos del parser se muestran al usuario. El archivo [PGN.txt](./PGN.txt) incluido en la raíz sirve como ejemplo mínimo de importación.

## Arranque local en Windows

Requiere Python 3.12 o posterior.

```powershell
.\run.ps1
```

Después abre [http://localhost:8000](http://localhost:8000). La documentación interactiva está en [http://localhost:8000/api/docs](http://localhost:8000/api/docs).

Si Windows bloquea la ejecución de scripts, permite únicamente esta ejecución sin cambiar la política global:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

Una vez instaladas las dependencias puedes acelerar los siguientes arranques con `.\run.ps1 -SkipInstall`.

Arranque manual:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r api\requirements.txt
.venv\Scripts\python -m uvicorn api.app.main:app --reload --port 8000
```

## Arranque con Docker

```bash
docker compose up --build
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8000/api/docs](http://localhost:8000/api/docs)

Los dos Dockerfiles y `docker-compose.yml` están preparados para la arquitectura modular actual. El contenedor de API copia también `web/js` y `web/vendor`, de modo que puede servir la SPA completa; el contenedor web sirve esos mismos recursos mediante Nginx y redirige `/api` a FastAPI.

> **Verificación pendiente:** la construcción y el arranque de las imágenes no se han ejecutado después de la refactorización. El 9 de agosto de 2026 se detectó el cliente de Docker, pero el motor de Docker Desktop no estaba en ejecución. Esto no afecta al arranque con `run.ps1`. Cuando el motor esté disponible se debe ejecutar el comando anterior y comprobar `/`, `/licenses.html`, el archivo fuente de Stockfish, `/api/v1/health`, la carga de una muestra y el visor.

## Pruebas

```powershell
.venv\Scripts\python -m pytest -q
```

Las pruebas comprueban que el ejemplo sintético no se precarga ni se confunde con una fuente real, los cinco idiomas, las tablas y reglas de la calculadora FIDE, además de los totales estadísticos, los filtros por ritmo y apertura, el reconocimiento de aperturas y transposiciones, la atribución de decisiones al jugador o al rival, la exclusión de variantes, la trazabilidad de una partida, las posiciones del visor, las integraciones de proveedor, el historial de los tres Elo FIDE y la importación PGN independiente con deduplicación e inferencia de jugador.

### Estado de verificación

A fecha de esta revisión, el estado es:

- **69 pruebas automatizadas superadas**.
- Todo el backend compila correctamente con `python -m compileall api`.
- Los 13 scripts declarados por la interfaz y el service worker pasan validación sintáctica.
- Todos los CSS y scripts referenciados por `index.html` se sirven con código HTTP 200 y las cabeceras de seguridad previstas.
- El contrato OpenAPI conserva los 18 endpoints públicos anteriores a la refactorización.
- La construcción Docker queda pendiente por falta de Docker en el equipo; no por un error conocido en los archivos de despliegue.

La batería emite actualmente un aviso de deprecación procedente de la integración entre `starlette.testclient` y `httpx`; no provoca fallos ni corresponde a una regla de negocio de ChessPrep.

## API principal

```text
GET  /api/v1/demo
GET  /api/v1/players/search?q={usuario}
POST /api/v1/players/combined
GET  /api/v1/players/{source}/{external_id}
POST /api/v1/players/{source}/{external_id}/refresh-games
GET  /api/v1/players/{source}/{external_id}/games
GET  /api/v1/players/{source}/{external_id}/stats
GET  /api/v1/players/{source}/{external_id}/stats/by-color
GET  /api/v1/players/{source}/{external_id}/stats/openings
GET  /api/v1/games/{source}/{game_id}
GET  /api/v1/fide/players/{fide_id}
GET  /api/v1/fide/players/{fide_id}/info64-results?from={YYYY-MM-DD}&to={YYYY-MM-DD}
POST /api/v1/elo/head-to-head
POST /api/v1/elo/initial
POST /api/v1/datasets
GET  /api/v1/datasets/{dataset_id}/games
GET  /api/v1/datasets/{dataset_id}/stats
```

Cada resultado estadístico declara su muestra, fuentes, ritmo y rango temporal. `GET /demo` devuelve únicamente el acceso al ejemplo ficticio, cuyos registros usan la fuente `demo` y confianza `synthetic`. `GET /fide/players/{fide_id}` incluye `rating_history`, con puntos mensuales validados para `rating`, `rapid_rating` y `blitz_rating`. La variación de una partida consulta la lista oficial actual de estándar, rápido o blitz para obtener Elo y K; el archivo comprimido se conserva temporalmente en memoria durante seis horas. El cálculo inicial consulta el historial FIDE completo de cada ID para el mes indicado y añade los dos empates virtuales contra rivales de 1800 previstos en el reglamento. `POST /datasets` crea siempre un dossier PGN independiente: no acepta fusionarlo con otro dataset. Los datasets importados se guardan únicamente en memoria y caducan por defecto a los 30 minutos.

## Configuración

Copia `.env.example` si quieres modificar:

- `CHESSPREP_DATASET_TTL_MINUTES`: duración del dataset temporal.
- `CHESSPREP_LICHESS_MAX_GAMES`: límite predeterminado de Lichess cuando la llamada no indica uno explícito.
- `CHESSPREP_LICHESS_USER_AGENT`: identificación enviada a Lichess. Antes de desplegar debe incluir la URL pública real de ChessPrep y un contacto válido.
- `CHESSPREP_CHESSCOM_MAX_GAMES`: límite predeterminado de Chess.com cuando la llamada no indica uno explícito.
- `CHESSPREP_INFO64_MAX_TOURNAMENTS`: máximo de participaciones recientes de Info64 verificadas en cada consulta OTB (1–100; 30 por defecto).
- `CHESSPREP_CORS_ORIGINS`: orígenes admitidos por la API.
- `CHESSPREP_ALLOWED_HOSTS`: nombres de host admitidos, sin protocolo ni puerto.
- `CHESSPREP_ENABLE_DOCS`: activa o desactiva `/api/docs` y el esquema OpenAPI.

## Seguridad al desplegar

La aplicación trata nombres, eventos y cabeceras PGN como texto, aplica codificación contextual en el navegador y normaliza los campos externos antes de guardarlos temporalmente. También limita los PGN a 5 MB y 500 partidas, restringe las URLs consultadas a los proveedores previstos y envía CSP, anti-framing, `nosniff`, política de permisos y otras cabeceras defensivas. El Nginx incluido añade además límite de cuerpo y limitación básica de peticiones a la API.

Antes de publicar, configura `CHESSPREP_ALLOWED_HOSTS` con el dominio exacto y `CHESSPREP_CORS_ORIGINS` con el origen HTTPS real. Si no necesitas la documentación interactiva, usa `CHESSPREP_ENABLE_DOCS=false`. Termina TLS en el proxy o plataforma de despliegue y configura HSTS allí; no se incluye HSTS en el contenedor porque el entorno local funciona por HTTP.

La disponibilidad de Lichess, Chess.com, FIDE e Info64 depende de sus respectivos servicios. Si una plataforma online no responde, el dossier combinado utiliza las demás que estén disponibles. Para consultar resultados OTB se exige un ID FIDE válido y cada participación de Info64 se vuelve a comprobar contra él. El ID y los resultados no proporcionan por sí solos las jugadas. La importación PGN es un flujo separado para reproducir y analizar posiciones, y no atribuye identidad FIDE al dossier creado.

Las llamadas a Lichess se serializan mediante un bloqueo único para todo el proceso. Después de un `429`, ninguna llamada nueva se realiza durante al menos 60 segundos o durante el `Retry-After` indicado si es mayor. El contenedor oficial ejecuta un solo proceso de Uvicorn; si el despliegue se amplía a varios procesos o réplicas, el bloqueo debe sustituirse por un coordinador compartido.
