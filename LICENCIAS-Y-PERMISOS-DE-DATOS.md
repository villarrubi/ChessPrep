# Licencias y permisos de las fuentes de datos

Última actualización: 3 de agosto de 2026.

## Finalidad de este documento

Este registro resume el estado de los contactos realizados para obtener partidas de ajedrez y deja claro qué usos están autorizados, cuáles requieren una aclaración y qué fuentes todavía no deben integrarse. No sustituye el texto completo de las licencias ni asesoramiento jurídico.

Los correos originales deben conservarse en formato `.eml`, con sus cabeceras completas, fuera del repositorio público. Este documento recoge únicamente el contenido operativo necesario para desarrollar ChessPrep y no reproduce la correspondencia completa.

## Resumen

| Fuente | Contacto registrado | Estado del permiso | Uso actual en ChessPrep | Próximo paso |
|---|---|---|---|---|
| [Lumbra’s Gigabase](https://lumbrasgigabase.com/) | Michael Jansen | Autorizado para un proyecto abierto, gratuito, estrictamente no comercial y sin monetización, bajo CC BY-NC-SA 4.0 | Todavía no integrado | Confirmar el índice persistente y la posible copia indexada en un servidor público |
| PGN Mentor | Equipo de PGN Mentor / 64 Squares | Autorización escrita para uso público no comercial; se prohíbe monetizar los PGN | Todavía no integrado | Aclarar atribución, automatización, almacenamiento y alcance de los derechos sobre material procedente de terceros |
| [The Week in Chess (TWIC)](https://theweekinchess.com/) | Mark Crowther | No existe permiso gratuito: se ha propuesto una licencia de 30 GBP al mes | No integrado | No utilizar hasta aceptar o negociar por escrito un acuerdo completo |
| YottaChess | Isaac; contacto iniciado por correo y LinkedIn | Sin respuesta o autorización registrada | No integrado | Esperar una respuesta escrita y archivar la identidad y el correo exactos del contacto |

## 1. Lumbra’s Gigabase

### Estado

**Autorización recibida para el modelo no comercial actual, con dos aclaraciones técnicas pendientes.**

Michael Jansen confirmó por escrito que ChessPrep puede utilizar Lumbra’s Gigabase gratuitamente bajo la licencia [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) mientras el proyecto permanezca:

- abierto;
- gratuito para todos los usuarios;
- estrictamente no comercial;
- sin publicidad, suscripciones, funciones de pago ni ninguna otra monetización.

El simple hecho de publicar ChessPrep y permitir que terceros accedan gratuitamente no activa por sí mismo la licencia comercial. Si el proyecto incorpora monetización en el futuro, habrá que contactar con Lumbra’s Gigabase antes de ponerla en funcionamiento.

### Condiciones y posibilidades confirmadas

- Lumbra’s Gigabase no dispone de una API ni de endpoints para exportar las partidas de un jugador concreto.
- ChessPrep o sus usuarios pueden consultar y filtrar una copia local, por ejemplo mediante ID FIDE.
- Se permite una caché temporal en memoria de entre 30 y 60 minutos.
- Se permite que el usuario descargue su propia copia de la Gigabase y señale su ubicación a ChessPrep.
- Debe mostrarse de forma clara y visible el texto **«Lumbra’s Gigabase»** con un enlace a <https://lumbrasgigabase.com/> en los créditos o en la interfaz relacionada.
- Al utilizar o distribuir una adaptación de la base deben respetarse la atribución, la limitación no comercial y el requisito ShareAlike de CC BY-NC-SA 4.0.

### Modelo comercial comunicado, actualmente no aplicable

Si ChessPrep deja de ser estrictamente no comercial, Michael ofrece dos modelos que habría que negociar antes del cambio:

1. Compra única de una instantánea fija, con licencia perpetua y correcciones estructurales, pero sin partidas nuevas.
2. Suscripción anual con actualizaciones mensuales y precio creciente durante los primeros cinco años hasta alcanzar un límite permanente.

También indicó que existen condiciones reducidas para proyectos pequeños cuyos ingresos se destinen principalmente a cubrir gastos. No se ha recibido todavía una tarifa concreta para estos modelos.

En el modelo comercial se exigirían, entre otras condiciones, impedir la redistribución de los archivos originales, convertir la información a una base de datos o formato binario, impedir la exportación completa y mantener la atribución. También se planteó una colaboración de escaparate y afiliación. Nada de esto debe aceptarse ni implementarse como compromiso comercial sin un acuerdo escrito definitivo.

### Aclaraciones pendientes

Antes de implementar la fuente conviene obtener confirmación escrita sobre estos puntos:

1. Si ChessPrep puede conservar en el equipo del usuario un índice SQLite o binario persistente derivado de su copia, separado de la caché temporal de 30–60 minutos.
2. Si una versión web pública y gratuita puede mantener en el servidor una copia convertida e indexada, inaccesible como archivo bruto y sin exportación masiva.
3. Si está permitido mostrar, reproducir y analizar partidas individuales obtenidas en una búsqueda.
4. Si esta atribución es adecuada: «Datos de partidas proporcionados por Lumbra’s Gigabase, procesados por ChessPrep bajo CC BY-NC-SA 4.0».
5. Qué significa exactamente «open» en su autorización: acceso público, código abierto o ambas cosas.

### Evidencia que debe archivarse

- Primer correo de Michael Jansen con las modalidades de licencia comercial y sus condiciones generales.
- Segundo correo de Michael Jansen aclarando la autorización gratuita para el proyecto no comercial.
- Futura respuesta a las aclaraciones técnicas anteriores.

## 2. PGN Mentor

### Estado

**Permiso escrito recibido para uso público no comercial, pero el alcance técnico y la cadena de derechos necesitan aclaración antes de una integración automática.**

PGN Mentor respondió que las partidas de su web pueden utilizarse públicamente y que sus archivos PGN no pueden utilizarse con fines comerciales. También indicó que su contenido fue recopilado a partir de otros sitios web y que dichas fuentes no permiten monetizar las partidas o los PGN.

### Condiciones confirmadas

- ChessPrep no puede monetizar los archivos PGN de PGN Mentor.
- El permiso comunicado está limitado al uso público no comercial.

### Riesgos y aclaraciones pendientes

- La respuesta no define si se permite la descarga automatizada o periódica.
- No concreta si ChessPrep puede almacenar, convertir, indexar o redistribuir partidas individuales.
- No indica una fórmula de atribución ni dónde debe aparecer.
- Al proceder el contenido de distintas webs, el correo no identifica las fuentes originales ni demuestra que PGN Mentor pueda conceder derechos adicionales sobre todas ellas.
- Debe aclararse si el permiso cubre una web pública que procese los PGN en un servidor o únicamente la descarga y el análisis manual por parte de cada usuario.

Hasta resolver esos puntos, PGN Mentor puede mantenerse como fuente candidata o como enlace para que el usuario obtenga archivos manualmente, pero no debe incorporarse todavía como una base descargada automáticamente por ChessPrep.

### Evidencia que debe archivarse

- Correo enviado solicitando permiso.
- Respuesta del equipo de PGN Mentor / 64 Squares.
- Cualquier respuesta futura sobre automatización, almacenamiento, atribución y fuentes originales.

## 3. The Week in Chess (TWIC)

### Estado

**Propuesta comercial recibida; no existe autorización gratuita para integrar la fuente.**

Mark Crowther indicó que acepta que TWIC se utilice como material de referencia y propuso una tarifa de **30 GBP al mes** para utilizarlo como fuente que alimente servicios como ChessPrep. También explicó que el mantenimiento de TWIC depende de conseguir financiación suficiente.

No se ha aceptado la propuesta ni se han acordado todavía el alcance, las actualizaciones, el almacenamiento, la atribución, las exportaciones, la duración o la cancelación. Por tanto, ChessPrep no debe descargar, indexar o integrar TWIC como proveedor de datos hasta que exista un acuerdo escrito y se decida asumir su coste.

Puede mantenerse un enlace normal a la web como referencia editorial, siempre que no se presente como una fuente integrada ni se copie su contenido.

### Próximo paso posible

- Declinar amablemente por ahora y conservar el contacto para una fase futura.
- O solicitar un borrador completo de licencia antes de valorar el pago mensual.

### Evidencia que debe archivarse

- Solicitud enviada a Mark Crowther.
- Respuesta que propone la tarifa de 30 GBP mensuales.
- Cualquier negociación o acuerdo posterior.

## 4. YottaChess

### Estado

**Contacto iniciado; no consta respuesta ni permiso concedido.**

Se preparó y realizó un contacto con Isaac mediante correo electrónico y LinkedIn porque no se encontró un canal corporativo más claro. La intención era solicitar primero permiso de acceso y uso de las partidas sin comprometer desde el inicio el desarrollo de una API. La posible colaboración técnica o creación de una API solo se plantearía después, si fuese útil para ambas partes.

Hasta recibir una autorización escrita, YottaChess no debe consultarse mediante scraping, automatización ni una API no oficial. Tampoco debe presentarse como proveedor de ChessPrep.

### Datos que faltan en el registro

- Nombre completo y cargo de Isaac.
- Dirección exacta a la que se envió el correo.
- Fecha y copia `.eml` del mensaje enviado.
- Respuesta, si llega, y alcance concreto del permiso.

## 5. Fuentes consideradas sin contacto o permiso confirmado

Durante la investigación se mencionaron otras fuentes, entre ellas ChessBase y ChessTempo. No consta en este registro una respuesta escrita de esas entidades. Mencionarlas o enlazarlas no equivale a disponer de autorización para descargar, automatizar, indexar o redistribuir su contenido.

Si ya se les envió algún mensaje, deben incorporarse a este documento cuando se disponga del `.eml` correspondiente. Mientras tanto, su estado es **no autorizado para integración**.

## 6. Fuentes ya utilizadas por ChessPrep sin correspondencia de permiso archivada

ChessPrep consulta actualmente Lichess, Chess.com, FIDE e Info64 y distribuye Stockfish para el análisis local. Este documento no registra todavía un permiso individual por correo de esos proveedores. Antes de un despliegue público estable se deben revisar y documentar por separado:

- los términos y límites de las API públicas de Lichess y Chess.com;
- las condiciones aplicables a la consulta de perfiles e historial de rating de FIDE;
- las condiciones aplicables a la extracción automatizada de participaciones y resultados de Info64;
- las obligaciones de la licencia GPLv3 de Stockfish y sus avisos de atribución y distribución de código fuente.

La importación de un PGN aportado manualmente por el usuario no concede a ChessPrep derechos sobre ese archivo. El usuario debe disponer de permiso para utilizarlo y ChessPrep debe limitarse al procesamiento solicitado.

## 7. Reglas internas antes de integrar una fuente nueva

Una fuente solo podrá activarse como proveedor cuando estén registrados:

1. La identidad del proveedor y su URL oficial.
2. La licencia pública aplicable o el permiso escrito del titular.
3. Si se permite uso local, alojamiento web, caché, indexación y actualización automática.
4. Los límites de descarga y frecuencia de consulta.
5. Las reglas para mostrar o exportar partidas individuales y para impedir exportaciones masivas cuando corresponda.
6. La atribución exacta que debe aparecer en la interfaz.
7. Las consecuencias de añadir publicidad, donaciones, afiliación, suscripciones o funciones de pago.
8. La ubicación privada de la evidencia original en formato `.eml`.

Ante cualquier duda, la fuente permanecerá desactivada hasta recibir una aclaración escrita.
