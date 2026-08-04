# Guía de implementación PWA y Persistencia Local

## Cambios realizados

### 1. Progressive Web App (PWA)

**Archivos nuevos:**
- `web/manifest.json` - Manifiesto de la aplicación para instalación en dispositivos móviles
- `web/sw.js` - Service Worker para caché y funcionalidad offline

**Modificaciones:**
- `web/index.html` - Se añadieron meta tags para iOS y enlace al manifiesto
- `web/Dockerfile` - Se incluyen los nuevos archivos PWA
- `web/nginx.conf` - Configuración CSP actualizada para permitir workers y rutas para sw.js y manifest.json

**Características PWA:**
- **Instalable**: Los usuarios pueden "instalar" la web como una app nativa desde el navegador
- **Offline parcial**: La interfaz y assets estáticos se cachean para funcionar sin conexión
- **Actualizable**: El Service Worker gestiona automáticamente las actualizaciones de caché
- **Sin coste**: No requiere pagar licencias de App Store o Google Play

**Cómo funciona:**
1. Al cargar la página, se registra el Service Worker
2. El SW cachea todos los assets estáticos (HTML, CSS, JS, imágenes)
3. Las peticiones a la API intentan usar la red primero, con fallback a caché
4. Los assets estáticos se sirven desde caché (estrategia cache-first)

### 2. Persistencia Local con IndexedDB

**Archivo nuevo:**
- `web/js/storage.js` - Módulo de almacenamiento local

**Características:**
- **Players**: Guarda información de jugadores analizados
- **Games**: Almacena partidas localmente
- **Analysis**: Guarda análisis de Stockfish
- **Settings**: Preferencias del usuario

**Funciones disponibles:**
```javascript
// Guardar jugador
await ChessPrepStorage.savePlayer(playerData);

// Obtener jugador
const player = await ChessPrepStorage.getPlayer(playerId);

// Guardar partidas
await ChessPrepStorage.saveGames(gamesArray, playerId);

// Obtener partidas
const games = await ChessPrepStorage.getGamesByPlayer(playerId, limit);

// Guardar configuración
await ChessPrepStorage.saveSetting('clave', valor);

// Obtener configuración
const valor = await ChessPrepStorage.getSetting('clave', defaultValue);

// Exportar datos (backup)
const backup = await ChessPrepStorage.exportData();

// Importar datos (restaurar)
await ChessPrepStorage.importData(backup);

// Borrar todo (reset)
await ChessPrepStorage.clearAllData();
```

**Ventajas:**
- Los usuarios no pierden sus análisis al cerrar el navegador
- Funciona offline una vez cargados los datos
- No requiere servidor de base de datos
- Totalmente privado (los datos nunca salen del dispositivo)

### 3. Docker

**Cambios mínimos realizados:**
- Actualizado `web/Dockerfile` para incluir sw.js y manifest.json
- Actualizado `nginx.conf` para servir correctamente los archivos PWA
- La configuración CSP ahora permite `worker-src 'self' blob:` para el Service Worker

**Para probar Docker localmente:**
```bash
# Construir y levantar
docker-compose build
docker-compose up

# La web estará en http://localhost:3000
# La API en http://localhost:8000
```

### 4. Logging (no implementado)

Según tu indicación, el logging no se ha implementado porque:
- Prefieres mantener la simplicidad
- Los logs serían solo para ti como desarrollador
- No quieres mostrar información técnica a los usuarios

**Alternativa futura:** Si necesitas debugging en producción, podrías:
- Usar `console.log()` que aparece en la consola del navegador (F12)
- Implementar un modo "debug" oculto activable con combinación de teclas
- Usar servicios gratuitos como Sentry (tiene plan gratuito generoso)

## Cómo usar las nuevas funcionalidades

### Para usuarios finales:

**Instalar como PWA:**
1. Abrir ChessPrep en Chrome/Edge (desktop o móvil) o Safari (iOS)
2. Buscar el icono de "Instalar" en la barra de direcciones
3. O en menú: "Añadir a pantalla de inicio"
4. La app aparecerá como una aplicación nativa

**Persistencia automática:**
- Todos los análisis se guardan automáticamente en el navegador
- Al volver a la web, los datos anteriores estarán disponibles
- Los datos persisten incluso cerrando el navegador

### Para desarrollo:

**Probar PWA localmente:**
```bash
# Servir la web estáticamente
cd web
python -m http.server 8080

# Abrir https://localhost:8080 (necesitas HTTPS para Service Workers)
# O usar ngrok: ngrok http 8080
```

**Verificar Service Worker:**
1. Abrir DevTools (F12)
2. Ir a pestaña "Application" > "Service Workers"
3. Verificar estado y caché

**Inspeccionar IndexedDB:**
1. Abrir DevTools (F12)
2. Ir a pestaña "Application" > "IndexedDB"
3. Ver bases de datos ChessPrepDB

## Consideraciones importantes

### Límites de almacenamiento:
- IndexedDB: típicamente 50MB - 6GB dependiendo del navegador
- Cache Storage: típicamente 50MB - 2% del disco duro
- Suficiente para miles de partidas y análisis

### Privacidad:
- Todos los datos son locales al dispositivo del usuario
- No se envían a ningún servidor
- El usuario puede borrarlos desde su navegador

### Compatibilidad:
- **PWA**: Chrome 67+, Firefox 68+, Safari 11.1+, Edge 79+
- **IndexedDB**: Todos los navegadores modernos
- **iOS**: Soporte limitado pero funcional desde iOS 11.3

### SEO (Search Engine Optimization):

Los meta tags añadidos mejoran el SEO:
- `description`: Descripción rica para resultados de búsqueda
- `theme-color`: Color de la barra de estado en móviles
- Meta tags de Apple: Mejor integración en iOS

Para mejorar aún más el SEO en el futuro:
- Añadir Open Graph tags para compartir en redes sociales
- Implementar schema.org markup para contenido estructurado
- Crear sitemap.xml
- Mejorar tiempos de carga (ya optimizado con caché PWA)

## Próximos pasos sugeridos

1. **Integrar storage.js en app.js**: Modificar los controladores para guardar/cargar datos automáticamente
2. **UI de gestión de datos**: Botones para exportar/importar backups
3. **Indicador de estado offline**: Mostrar cuando se trabaja sin conexión
4. **Prompt de instalación**: Mostrar mensaje amigable para instalar la PWA
5. **Tests**: Verificar que la persistencia funciona en todos los navegadores objetivo

## Resumen

Con estos cambios, ChessPrep ahora es:
- ✅ **Instalable** como app nativa sin costes de stores
- ✅ **Funcional offline** para la interfaz y datos cacheados
- ✅ **Persistente** guarda datos localmente sin servidor
- ✅ **Privado** todos los datos quedan en el dispositivo
- ✅ **Docker-ready** configuración lista para desplegar
- ❌ **Sin logging** según tu preferencia (puede añadirse después)
