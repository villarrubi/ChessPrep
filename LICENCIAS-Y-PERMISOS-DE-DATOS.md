# Licencias y permisos de las fuentes de datos

**Última revisión:** 9 de agosto de 2026
**Ámbito:** inventario operativo; no sustituye asesoramiento jurídico especializado.

## Finalidad y criterio de este registro

Este documento separa tres cuestiones que no deben confundirse:

1. que una página o API sea accesible públicamente;
2. que su titular permita reutilizar los datos en ChessPrep;
3. que la implementación respete las condiciones técnicas, de atribución y de protección de datos.

La existencia de un proveedor en el código no significa que esté autorizado para un despliegue público. Los correos originales deben conservarse como `.eml`, con cabeceras completas y adjuntos, fuera del repositorio público. Aquí solo se registra el efecto operativo de cada evidencia.

### Significado de los estados

- ✅ **Utilizable:** existe una licencia pública o un permiso escrito que cubre el uso previsto, sin perjuicio de cumplir sus condiciones.
- ⚠️ **Condicionado:** existe acceso o permiso parcial, pero falta aclarar un aspecto material. No debe activarse públicamente fuera del alcance indiscutido.
- ⏸️ **Aplazado:** la fuente no está integrada y su evaluación queda detenida hasta que el proyecto decida retomarla.
- ❌ **No utilizar:** no existe permiso suficiente, fue denegado o requiere un acuerdo aún no celebrado.

## Resumen operativo

| Fuente | Evidencia disponible | Estado | Decisión actual para ChessPrep |
|---|---|---:|---|
| [Lichess chess-openings](https://github.com/lichess-org/chess-openings) | Base de nombres y posiciones publicada bajo CC0 1.0 | ✅ **Utilizable** | Copia local fijada a una revisión concreta para clasificar aperturas y transposiciones; licencia incluida junto a los datos |
| [Lichess](https://lichess.org/) | API y términos públicos; exportaciones bajo CC0; respuesta positiva recibida | ✅ **Cerrado** | Integración autorizada bajo las condiciones públicas y cerrada técnicamente para un único proceso: una petición simultánea como máximo y pausa global mínima de 60 segundos tras `429`. Solo requiere la configuración ordinaria de despliegue del `User-Agent` real |
| [Lumbra's Gigabase](https://lumbrasgigabase.com/) | CC BY-NC-SA 4.0 pública y permiso por correo de Michael Jansen; aclaración enviada sobre el significado de “open” | ⏸️ | Aplazado por decisión del proyecto. No hay código ni datos de Lumbra en ChessPrep y no se activará hasta retomarlo y cerrar por escrito la aclaración pendiente |
| [Chess.com](https://chess.com/) | PubAPI documentada; notificación enviada; sin confirmación específica | ⚠️ | No activar públicamente hasta aclarar por escrito el uso como aplicación externa bajo los términos de marzo de 2026 |
| [PGN Mentor](https://www.pgnmentor.com/) | Permiso privado para uso no comercial | ⚠️ | Uso no comercial dentro del permiso; no automatizar descargas ni almacenamiento hasta aclararlo |
| [ChessTempo](https://chesstempo.com/) | API externa denegada; sus términos prohíben descarga masiva y scraping | ⚠️ | Sin automatización. Un PGN aportado por el usuario solo puede tratarse bajo responsabilidad y declaración del propio usuario |
| [FIDE Ratings](https://ratings.fide.com/) | Datos y listas públicas, pero aviso de derechos reservados | ⚠️ | Calculadora manual sí; scraping de perfiles, históricos y reutilización automatizada no deben publicarse sin permiso escrito |
| [Info64/FEDA](https://info64.org/) | Solicitud enviada; sin respuesta | ❌ | El proveedor existe en el código, pero debe quedar desactivado en cualquier despliegue público |
| [Chess Archive](https://chessarchive.net/) | Conversación abierta; ChessPrep ya respondió concretando el uso y la licencia mencionada | ❌ | Respuesta enviada; esperar su contestación. No integrar ni descargar de forma automatizada hasta recibir condiciones o permiso expreso |
| [The Week in Chess](https://theweekinchess.com/) | Oferta comercial de 30 GBP/mes | ❌ | No usar como fuente mientras no se celebre y pague el acuerdo |
| [YottaChess](https://www.yottachess.com/) | Sin respuesta | ❌ | No integrar |

---

## 1. Lichess ✅

### Evidencia

- Los [términos de Lichess](https://lichess.org/terms-of-service) permiten utilizar sus servicios en aplicaciones, proyectos, investigaciones o productos, sujetos a las licencias y límites aplicables.
- La [base descargable de Lichess](https://database.lichess.org/) se publica bajo CC0 y permite descargar, modificar y redistribuir sus exportaciones.
- Las [reglas oficiales de la API](https://lichess.org/page/api-tips) exigen realizar una sola petición a la vez y esperar un minuto completo antes de reanudar las llamadas después de un `429`.
- Tras la notificación de ChessPrep, el equipo de Lichess respondió:

> “We are happy to hear that our data and platform has been helpful. Thank you for extending the free chess ecosystem!”

Esta respuesta es una confirmación positiva de conocimiento, pero no sustituye ni amplía las licencias y condiciones públicas. Debe conservarse el correo original en `.eml` con sus cabeceras.

### Permitido

- Consultar perfiles y partidas públicas mediante endpoints documentados.
- Normalizar las partidas y calcular estadísticas derivadas.
- Mostrar las partidas consultadas con enlace y atribución a Lichess.
- Usar las exportaciones identificadas expresamente como CC0 bajo sus condiciones.

### Controles implementados y obligaciones continuas

- Las llamadas se serializan mediante un único bloqueo para todo el proceso, también cuando haya varios usuarios simultáneos. El contenedor oficial ejecuta un solo proceso; un despliegue con varios procesos o réplicas necesitará un coordinador compartido.
- Tras un `429`, el proveedor bloquea nuevas llamadas durante al menos un minuto y respeta un `Retry-After` numérico mayor.
- Antes de desplegar, configurar `CHESSPREP_LICHESS_USER_AGENT` con la URL pública real de ChessPrep y un contacto válido. Es una configuración de cada entorno, no una autorización pendiente.
- No sustituir la API por scraping o automatización del navegador.
- No facilitar asistencia durante una partida en curso y advertirlo claramente al usuario.

**Conclusión:** expediente cerrado para el alcance actual. La fuente es utilizable conforme a sus condiciones públicas y la respuesta recibida acredita que Lichess conoce favorablemente el proyecto. Los controles de concurrencia y `429` están implementados y cubiertos por pruebas. Cada despliegue debe conservar la atribución, identificar correctamente al cliente y mantener un único proceso o un bloqueo distribuido equivalente.

### Base de aperturas de Lichess

La base independiente [`lichess-org/chess-openings`](https://github.com/lichess-org/chess-openings) declara sus datos de nombres, líneas y posiciones en el dominio público mediante CC0 1.0. ChessPrep incorpora una copia derivada de la revisión `4b8622759e7ae6f93f011cc6c83a3823401ab45e`, reducida a ECO, nombre y EPD, para identificar aperturas por la posición alcanzada y admitir transposiciones. El archivo de procedencia y el texto completo de CC0 se conservan en `api/app/data/openings/`.

---

## 2. Lumbra's Gigabase ⏸️

### Evidencia

La página oficial identifica de forma reiterada “Lumbra's Gigabase © 2024-2026 by Michael Jansen” como [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) y ofrece las bases completas en PGN y Scid. La web indica `business@lumbrasgigabase.com` para consultas de licencia.

Por correo, Michael Jansen confirmó que ChessPrep puede usar la base sin tarifa mientras permanezca estrictamente no comercial, “open” y gratuito para los usuarios. También confirmó que se puede filtrar una copia local, usar una copia aportada por el usuario, mantener caché temporal de 30–60 minutos y atribuir mediante “Lumbra's Gigabase” con enlace. ChessPrep aceptó además, para esta integración concreta, no redistribuir los PGN brutos, almacenar de forma indexada o binaria, impedir una exportación completa y contactar antes de cualquier monetización.

ChessPrep ya ha pedido por escrito que aclare si “open” significa públicamente accesible y gratuito o si exige que el código propio sea open source. El código de ChessPrep está previsto como propietario, por lo que esta diferencia es material.

### Permitido bajo CC BY-NC-SA 4.0

- Descargar, copiar y adaptar el material licenciado.
- Redistribuirlo con atribución, únicamente para fines no comerciales y aplicando ShareAlike a las adaptaciones compartidas.

### Decisión actual

- La integración queda aplazada y no forma parte del trabajo activo.
- No existe código, copia de la base ni descarga automatizada de Lumbra en el repositorio.
- No se incorporará ni publicará material de Lumbra mientras la integración esté aplazada.
- Al retomarla, deberá revisarse la respuesta sobre “open” y aplicar tanto CC BY-NC-SA 4.0 como los compromisos particulares asumidos por ChessPrep.
- Los correos y el comprobante del café de agradecimiento deben conservarse como evidencia privada fuera del repositorio; ese agradecimiento no supone contratar una licencia comercial.

---

## 3. Chess.com ⚠️

### Evidencia

- La [PubAPI oficial](https://support.chess.com/en/articles/9650547-what-is-the-pubapi-and-how-do-i-use-it) ofrece perfiles, partidas y torneos públicos, documenta caché y límites, y advierte de que las solicitudes paralelas pueden provocar `429`.
- Esa misma documentación indica que quienes quieran construir una aplicación o servicio para miembros de Chess.com deben contactar mediante su formulario.
- El [User Agreement vigente](https://www.chess.com/legal/user-agreement) contiene restricciones amplias sobre extracción automatizada, usos derivados, herramientas educativas y bases de datos, salvo autorización expresa.
- ChessPrep notificó su uso, pero no consta todavía una respuesta que delimite el permiso.

### Permitido sin discusión

- Desarrollo y pruebas muy limitadas usando exclusivamente endpoints de la PubAPI y respetando su documentación.
- Enlaces a las páginas originales.
- Importación manual de un PGN por su legítimo usuario, siempre que este declare que puede usarlo.

### No hacer todavía

- Activar públicamente la integración como servicio estable sin aclaración escrita o aprobación del formulario para desarrolladores.
- Scrapear páginas HTML o usar automatización de navegador.
- Descargar de forma masiva, crear una base sustitutiva o reutilizar elementos de marca, piezas, sonidos, colores o presentación propios de Chess.com.
- Hacer llamadas paralelas. La implementación actual consulta perfil y estadísticas en paralelo y debe serializarse antes de un uso público.

**Próximo paso:** reenviar la solicitud incluyendo endpoints, volumen máximo, caché, estadísticas derivadas, ausencia de redistribución masiva y forma de atribución.

---

## 4. PGN Mentor ⚠️

**Evidencia:** permiso privado para uso público no comercial.

### Permitido

- Usar material dentro del alcance exacto del correo y sin monetización.
- Conservar atribución visible a PGN Mentor.

### Pendiente

- Descarga automatizada.
- Almacenamiento en servidor y duración de la caché.
- Redistribución de partidas o conjuntos.
- Fórmula exacta de atribución.

No se debe implementar un recolector automático hasta recibir estas respuestas.

---

## 5. ChessTempo ⚠️

**Evidencia:** Richard confirmó que no existe una API externa documentada. Los [términos de ChessTempo](https://chesstempo.com/tos) prohíben la descarga masiva y el scraping.

### Permitido

- Mantener un importador PGN genérico donde el usuario aporta un archivo que tiene derecho a usar.
- Enlazar a ChessTempo sin copiar su contenido.

### No permitido o no acreditado

- API no documentada, ingeniería de endpoints internos, scraping o descarga masiva.
- Afirmar que “ChessTempo ha autorizado sus PGN para ChessPrep”. El correo citado solo deniega/descarta una API externa; no concede una licencia general sobre los PGN descargados por usuarios.

La interfaz debe exigir que el usuario confirme que dispone de derechos o permiso sobre cualquier PGN que suba.

---

## 6. FIDE Ratings ⚠️

### Evidencia

- FIDE ofrece [listas oficiales descargables](https://ratings.fide.com/download_lists.phtml) y publica datos de rating.
- Sin embargo, las fichas de `ratings.fide.com` muestran un aviso de derechos reservados que prohíbe reproducir, almacenar o transmitir el sitio sin permiso escrito.
- La publicación de datos personales por FIDE no equivale automáticamente a autorizar que un tercero los recopile, conserve y vuelva a publicar para otra finalidad.

### Permitido ahora

- Implementar las fórmulas de los reglamentos FIDE con datos introducidos manualmente por el usuario.
- Enlazar a la ficha o lista oficial sin copiarla.
- Usar los reglamentos como referencia, citándolos y sin presentar el resultado de ChessPrep como rating oficial.

### No activar públicamente sin permiso

- Scraping de perfiles e historiales.
- Descarga, caché y consulta automatizada de listas para resolver jugadores de terceros.
- Reproducción pública de nombres, IDs, federaciones e históricos obtenidos automáticamente.

Además del permiso de propiedad intelectual, este tratamiento requiere revisar RGPD: finalidad, base jurídica, información al interesado, conservación, fuente de los datos y ejercicio de derechos.

---

## 7. Info64/FEDA ❌

**Estado:** solicitud enviada y sin autorización escrita.

Aunque la información sea visible públicamente, no consta una API pública ni un permiso para recorrer automáticamente buscadores, torneos, calendarios y emparejamientos. El código existente verifica IDs FIDE y limita torneos, pero esas precauciones no sustituyen la autorización.

### Decisión

- No desplegar públicamente las rutas ni la interfaz de Info64.
- No realizar scraping automático.
- Mantener la implementación detrás de una bandera desactivada o retirarla del build público hasta recibir respuesta.

---

## 8. Chess Archive ❌

**Estado:** conversación abierta. Chess Archive solicitó que se concretara qué “license agreement” se había mencionado y ChessPrep ya respondió explicando el uso previsto y la licencia propuesta.

No existe todavía una licencia concedida. CC BY-NC-SA 4.0 solo puede proponerse como una opción; no debe afirmarse que Chess Archive ya publica sus datos bajo esa licencia.

En la respuesta enviada se han planteado las dos vías que deben quedar resueltas por escrito:

1. que Chess Archive aplique CC BY-NC-SA 4.0 al material sobre el que tenga derechos, entendiendo que permite redistribución no comercial y adaptaciones bajo ShareAlike; o
2. que conceda a ChessPrep un permiso particular para consultar, procesar, almacenar temporalmente y mostrar partidas/estadísticas, sin redistribución masiva.

No hace falta enviar otro correo ahora. Hasta recibir su contestación sobre alcance, atribución, automatización, caché, límites y redistribución, no se debe integrar ni automatizar ninguna descarga.

---

## 9. The Week in Chess (TWIC) ❌

**Evidencia:** propuesta de Mark Crowther de 30 GBP mensuales para alimentar servicios como ChessPrep.

No usar como fuente, espejo, caché o alimentación automatizada mientras no se celebre el acuerdo y se asuma su coste. Se puede mantener un enlace externo ordinario.

---

## 10. YottaChess ❌

**Estado:** sin respuesta tras el contacto inicial.

No integrar, descargar ni automatizar hasta recibir permiso escrito.

---

## 11. PGN aportados por usuarios

El formato PGN no otorga derechos sobre el contenido de un archivo concreto. La importación manual puede mantenerse si:

- el usuario confirma que el archivo es suyo, es de dominio público, está debidamente licenciado o tiene permiso para usarlo;
- ChessPrep explica que el archivo se procesa temporalmente y durante cuánto tiempo;
- no se incorpora automáticamente a una base común ni se redistribuye;
- existe un canal para solicitar retirada o ejercer derechos sobre datos personales.

La interfaz actual necesita una declaración/aceptación explícita antes de la subida y una política de privacidad accesible.

---

## 12. Stockfish, chess.js y código de ChessPrep

### Decisión sobre el código propio

- El código propio de **ChessPrep se mantendrá como software propietario y de código cerrado**. No se aplicará CC BY-NC-SA 4.0, GPLv3 ni otra licencia de código abierto al código propio.
- Antes de distribuir la aplicación debe añadirse en la raíz un aviso o licencia de uso propietaria que identifique al titular, reserve los derechos y explique qué uso se concede al usuario. Los componentes y datos de terceros deben quedar expresamente excluidos de esa reserva y conservar sus propias licencias.
- Si se quiere mantener la confidencialidad del código, el repositorio debe ser privado. Publicarlo en GitHub permite verlo y copiarlo materialmente aunque no conceda una licencia de reutilización; volverlo privado no retira las copias que ya se hayan obtenido.
- ChessPrep no debe describirse como “open source”. Sí puede indicarse por separado que determinados datos, documentos o componentes de terceros se usan bajo sus licencias correspondientes.
- CC BY-NC-SA 4.0 puede utilizarse para datos o documentación, pero no debe presentarse como licencia del software. Si se adapta material sujeto a esa licencia, el material adaptado debe atribuirse y compartirse bajo CC BY-NC-SA 4.0, separado del código propietario.

### Stockfish: permiso y obligaciones

- **No es necesario pedir permiso individual a Stockfish:** la GPLv3 ya concede permiso para usar, modificar y distribuir el programa si se cumplen sus condiciones. Un correo solo sería necesario para solicitar una licencia distinta, una excepción propietaria o una aclaración que la GPL no resuelva.
- La distribución local incluye actualmente la licencia GPLv3 en `web/vendor/stockfish/COPYING.txt`, el aviso general en `web/vendor/NOTICE.md` y un registro de procedencia y hashes en `web/vendor/stockfish/SOURCE.md`.
- El código fuente correspondiente exacto de `stockfish@18.0.8` se conserva en `web/vendor/stockfish/source/stockfish.js-18.0.8-source.tar.gz`, generado desde el commit npm `93c994592dcf3b4b21052ab925e9b534df9c0918`. La página pública `/licenses.html` permite descargarlo y consultar la GPLv3, los avisos, hashes e instrucciones de compilación.
- La compilación incorpora la red ligera `nn-9067e33176e8.nnue`, identificada en el encabezado conservado del propio Worker y en el código fuente. Los créditos a Linmiao Xu (`linrock`) se mantienen visibles en el archivo distribuido y en los avisos públicos.
- El archivo fuente conserva una copia de UglifyJS 3.17.4 utilizada por el proceso de construcción. Su aviso BSD-2-Clause se distribuye junto al archivo en `web/vendor/stockfish/UGLIFYJS-LICENSE.txt`.
- Deben conservarse la GPL, los avisos de copyright y la información de procedencia. Si se modifica Stockfish, también deben publicarse bajo GPLv3 el código modificado y la información necesaria para reconstruir esa versión.
- Stockfish se ejecuta como un Web Worker separado y se comunica mediante órdenes UCI de texto. Esta separación técnica favorece que el código propio de ChessPrep se trate como una obra independiente, pero antes de distribuir una aplicación propietaria debe revisarse jurídicamente que no se haya creado una obra combinada o derivada sujeta a GPLv3.
- Referencias oficiales: [repositorio y condiciones de Stockfish](https://github.com/official-stockfish/Stockfish) y [preguntas frecuentes de la GPL](https://www.gnu.org/licenses/gpl-faq.html).

### chess.js

- Mantener su licencia BSD y sus avisos en `web/vendor/chess` y en la página pública de atribuciones.

---

## Qué puede publicarse ahora y qué debe bloquearse

### Puede mantenerse

- Ejemplo ficticio y cálculos locales deterministas.
- Importación PGN temporal, después de añadir declaración de derechos y política de privacidad.
- Stockfish local y chess.js: sus licencias, avisos, hashes y, para Stockfish, el acceso al código fuente correspondiente exacto ya están incorporados y cubiertos por pruebas de distribución.
- Calculadora FIDE con introducción manual de datos y aviso de que es una estimación no oficial.
- Lichess, cuyo expediente queda cerrado para el alcance actual, manteniendo los controles implementados, la atribución y un `User-Agent` real en cada despliegue.

### No debe salir habilitado en un despliegue público actual

- Info64.
- Scraping de perfiles e históricos FIDE y resolución automática mediante listas FIDE.
- Chess Archive.
- TWIC y YottaChess.
- Automatización de ChessTempo o PGN Mentor.
- Chess.com como integración estable hasta recibir aclaración escrita bajo sus términos de 2026.
- Lumbra's Gigabase, aplazado por decisión del proyecto y sin integración actual.

**Conclusión operativa:** la compilación actual no debería desplegarse públicamente tal como está porque expone funciones FIDE/Info64 y Chess.com que siguen condicionadas o no autorizadas.

---

## Controles necesarios antes de publicar

1. Añadir banderas de activación por proveedor y dejar desactivadas por defecto las fuentes no autorizadas.
2. Crear una página de atribuciones con fuente, URL, licencia, fecha de consulta y cambios realizados.
3. Publicar términos de uso y política de privacidad/RGPD.
4. Exigir una declaración de derechos antes de importar PGN.
5. Añadir en la raíz un aviso o licencia de uso propietaria para el código propio, con una exclusión expresa de datos y componentes de terceros; hacer privado el repositorio si se desea mantener confidencial el código.
6. Mantener accesibles `/licenses.html`, la GPLv3, los avisos y el archivo fuente exacto de Stockfish en cada despliegue. El repositorio incluye una prueba automática de presencia, enlaces y hashes; durante la publicación también debe comprobarse el servidor final.
7. Implementar límites globales por proveedor, caché conforme a cada fuente y tratamiento correcto de `429`.
8. Evitar asistencia durante partidas en curso y comunicarlo en la interfaz.
9. Guardar los permisos y respuestas como `.eml` con cabeceras completas y registrar aquí su alcance, no solo un resumen favorable.
10. Solicitar revisión profesional antes del lanzamiento público, especialmente sobre bases de datos, propiedad intelectual, la separación entre Stockfish y el código propietario, y RGPD.

---

**Documentación mantenida por:** Alejandro Villarrubia, Gonzalo José Colina y Francisco Javier Juárez
**Contacto:** ver `README.md`.
