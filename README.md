# STOPee.com.mx

Plataforma oficial y tienda en línea de **STOPee**: concentrado biotecnológico que neutraliza y degrada los residuos de orina canina en la vía pública. Sitio de marketing (landing con scrollytelling 3D), tienda en línea con suscripciones, blog cívico, cuenta de cliente y un backoffice/BI completo para administrar todo el negocio.

> **Publicar en la nube:** ver [DEPLOY.md](DEPLOY.md) (Google Cloud Run + MongoDB Atlas + Cloud Storage).

---

## 🚀 Comandos rápidos

### 1. Levantar MongoDB (una sola vez, queda corriendo)

Este proyecto usa una instancia de MongoDB local **persistente**, en el puerto `27018` (no el 27017 por default, para no chocar con otro Mongo que tengas instalado). Corre como proceso independiente (`--fork`), así que una vez levantada se queda encendida aunque cierres la terminal — no hace falta repetir esto cada vez.

```bash
mongod --dbpath ~/mongodb-data/stopee-dev --port 27018 --bind_ip 127.0.0.1 --fork --logpath ~/mongodb-data/stopee-dev.log
```

Para confirmar que ya está corriendo (por si no te acuerdas si la dejaste encendida):

```bash
nc -zv 127.0.0.1 27018
```

Para apagarla (normalmente no hace falta):

```bash
pkill -f "mongod --dbpath.*stopee-dev"
```

### 2. Levantar el sitio (frontend + backend, React Router corre ambos juntos)

```bash
npm install        # solo la primera vez, o cuando cambien las dependencias
npm run dev
```

Abre lo que indique la terminal (`http://localhost:4827` — el puerto se define con `PORT` en `.env` y está bloqueado (`strictPort`): si está ocupado falla en vez de saltar a otro).

### 3. Otros comandos útiles

```bash
npm run build       # build de producción
npm run start        # sirve el build de producción (después de "build")
npm run typecheck    # revisa tipos de TypeScript sin compilar
npm run seed:blog    # crea los 4 artículos de blog originales (idempotente, seguro repetir)
```

### Acceso de administrador (local)

Crea tu cuenta en `/cuenta/registro`, conviértela en super administradora con `npm run make-admin -- tu-correo@ejemplo.com` e inicia sesión en `/admin/login`. (Ya no se promueve sola por el correo de `ADMIN_EMAIL`: eso permitía que cualquiera que se registrara primero con ese correo se quedara con el panel.)

---

## 📦 Qué es este proyecto

STOPee vende un concentrado biotecnológico (Bacillus subtilis + ricinoleato de zinc) para neutralizar la orina canina en banquetas, postes y fachadas. El sitio cubre tres frentes:

1. **Marketing / adquisición**: landing de pre-lanzamiento con lista de espera, landing "lanzada" con animación 3D de modo de uso, blog cívico, banners editables.
2. **Comercio**: catálogo, carrito, checkout con Stripe, suscripciones (auto-envío recurrente), programa de lealtad, cupones y promociones.
3. **Backoffice**: dashboard con métricas reales (no simuladas), gestión de catálogo/pedidos/clientes/blog/promociones/banners, todo protegido con autenticación de admin.

## 🛠️ Stack técnico

| Capa | Tecnología |
|---|---|
| Framework | [React Router 7](https://reactrouter.com) en modo framework (Vite, TypeScript; antes Remix 2) — front y back en el mismo proyecto |
| Base de datos | MongoDB vía Mongoose |
| Pagos | Stripe (Checkout para compra única + Billing para suscripciones) |
| Estilos | Tailwind CSS |
| 3D / animación | React Three Fiber + drei + GSAP (ScrollTrigger) |
| Gráficas del dashboard | Recharts |
| Markdown | `marked` (contenido del blog) |
| Validación de formularios | Zod |

No hay build de un "frontend" separado — React Router sirve las rutas del sitio público, el backoffice y las APIs (incluyendo el webhook de Stripe) desde el mismo servidor.

---

## ✅ Qué está listo

### Tienda pública
- Landing de pre-lanzamiento (captura de correos para lista de espera) que se activa/desactiva desde `/admin/settings` sin tocar código.
- Landing "lanzada": hero editable (banner de promoción o banner personalizado) → animación 3D de modo de uso (scroll-jacked, procedural, sin archivos `.glb`) → razones para usar STOPee → vitrina de tienda/blog.
- Página `/modo-de-uso` independiente (siempre disponible, sin importar si la tienda está activa).
- Catálogo (`/tienda`) con productos individuales y paquetes, selector de cantidad (no hay que darle "Agregar" varias veces), página de detalle por producto con ingredientes y modo de uso.
- Carrito persistente (cookie) con ajuste de cantidad +/-, cupones, banner de regalo desbloqueado.
- Blog Cívico con posts en base de datos (crear/editar/borrar/programar desde el admin), no en archivo estático.
- Elementos visuales de marca (los remolinos recortados de la etiqueta oficial) con paralax sutil al hacer scroll en las secciones oscuras.

### Compra y pagos
- Checkout de una sola compra vía Stripe Checkout.
- Suscripción de auto-envío (Stripe Billing) con frecuencias configurables (3/4/6/8 semanas), pausar/reanudar/cambiar frecuencia desde `/cuenta`.
- Programa de lealtad **por ciclos** (no permanente): cada N compras se gana una recompensa (descuento o regalo físico) para la siguiente compra únicamente, configurable por niveles desde Promociones (1ª vez, 2ª vez, 3ª vez...).
- Motor de promociones con 10 estrategias en un solo modelo: cupón, BOGO, regalo gratis, nuevo cliente, escalonado por gasto, personalizado, venta flash, VIP primeros compradores, comprar juntos, lealtad, y "por requisito" (condición sobre un producto/paquete específico → descuento y/o regalo). **De estas, solo Cupón, Lealtad y "Por requisito" se aplican de verdad en el checkout** — el resto son configuración + banner (ver limitaciones abajo).
- Seguimiento de qué promoción se usó en cada pedido, para medir efectividad por promoción en el dashboard.

### Cuenta de cliente (`/cuenta`)
- Historial de pedidos, gestión de suscripción, estado del programa de lealtad.
- Perfil: teléfono, dirección de envío, y varios perros con nombre y cumpleaños (para poder ofrecer un detalle en su mes de cumpleaños).

### Backoffice (`/admin`)
- **Dashboard**: KPIs con comparación vs. periodo anterior, ventas por bundle/SKU, embudo de conversión con tracking propio, salud de suscripciones, camino a la Nª compra de lealtad, atribución por canal (UTM), inventario con alertas de stock bajo por producto, efectividad por promoción.
- **Pedidos**: paginados, filtrables por estado.
- **Catálogo**: productos y paquetes en secciones separadas (con submenú), crear/editar/borrar, fotos y video, precio de paquete calculado automáticamente a partir de sus componentes, unidad de medida por producto (litros/gramos/piezas/etc. — no todos los productos se miden igual) y umbral de stock bajo configurable por producto.
- **Promociones**: crear/editar/duplicar cualquiera de los 10 tipos, banner de hero opcional por promoción.
- **Banners**: banners de portada independientes de las promociones (para cambiar la imagen del home sin crear un descuento).
- **Blog**: crear/editar/borrar/programar publicación (fecha y hora exactas), editor con vista previa de Markdown.
- **Clientes**: perfil individual por cliente (datos de contacto, perros, línea de tiempo de comportamiento, historial de pedidos, estado de suscripción), detección automática de "candidato a suscripción" (compra seguido pero nunca se suscribió), registrados sin compra, compradores anónimos, carritos abandonados (con sesión iniciada), cumpleaños del mes.
- **Lista de espera**: filtro por fecha, exportar CSV, borrar registros.
- **Configuración**: activar/desactivar la tienda, pixeles de Google/Meta, barra de anuncio.

### Analítica propia
- Eventos propios (vista de página, vista de producto, agregar al carrito, clic en banner, iniciar checkout) — no depende de que el pixel de Meta/Google esté bien configurado para tener métricas.
- Atribución de primer clic (UTM) en pedidos.

---

## ⚠️ Qué falta / limitaciones conocidas

- **Dos catálogos separados**: la tienda pública real (`app/data/products.ts`, 5 SKUs fijos) es un archivo estático independiente del catálogo del admin (`ProductModel`/`BundleModel` en MongoDB, usado para inventario y márgenes). Agregar un producto en `/admin/catalog` **no lo pone a la venta** — hay que agregarlo también al archivo estático. Unificarlos es un cambio grande, pendiente.
- **La mayoría de los tipos de promoción no se aplican solos**: BOGO, regalo gratis, nuevo cliente, escalonado, personalizado, venta flash, VIP y comprar-juntos se configuran y muestran banner, pero no descuentan nada en el checkout todavía (solo Cupón, Lealtad y "Por requisito" sí funcionan de verdad).
- **Las suscripciones no aceptan cupones ni promociones** — solo tienen su descuento fijo de auto-envío.
- **No hay envío de correos automatizado**: bienvenida, recuperación de carrito, aviso de lanzamiento a la lista de espera, cumpleaños — todo esto está *identificado* en el admin (quién, cuándo) pero no se envía nada solo; requiere integrar un servicio de correo (Resend, SendGrid, etc.).
- **Fotos de producto**: el modelo del admin soporta subir fotos/video, pero la tienda pública real todavía muestra un placeholder con gradiente en vez de una foto.
- **Stripe sin probar en vivo**: las llaves en `.env` son de ejemplo (`sk_test_xxx`); hace falta una cuenta de Stripe real con productos/precios creados y el webhook configurado antes de poder cobrar de verdad.
- **Subida de archivos a disco local** (`public/uploads/`): funciona para un servidor con disco persistente, pero no en plataformas serverless de filesystem efímero (Vercel, etc.) — habría que migrar a S3/Cloudinary antes de desplegar ahí.
- **Sin pruebas automatizadas** (no hay Jest/Vitest/Playwright configurado).
- **Sin despliegue configurado todavía** — este entorno es de desarrollo local. `.env.example` trae un ejemplo de conexión a MongoDB Atlas para cuando se decida hospedar en producción.

---

## 🧠 Cómo funciona (arquitectura, por si vas a tocar código)

- **Rutas**: convención de archivos planos (se declara en `app/routes.ts` con `flatRoutes()`; `admin.catalog_.products.tsx` → `/admin/catalog/products`, el `_` evita que anide bajo `admin.catalog.tsx`).
- **Base de datos**: Mongoose, conexión cacheada en `app/lib/db.server.ts` (con recuperación automática si el primer intento de conexión falla).
- **Autenticación**: `app/lib/session.server.ts` — el admin reutiliza el mismo sistema de sesión de clientes; el rol `superadmin` solo se asigna con `npm run make-admin` (desde Clientes → Nuevo usuario el super administrador crea administradores y clientes), y el acceso al panel caduca a las 8 horas.
- **Pagos**: `app/lib/stripe.server.ts` centraliza la creación de sesiones de Checkout y Billing; `app/routes/webhooks.stripe.tsx` sincroniza pedidos/suscripciones/lealtad cuando Stripe confirma el pago.
- **Promociones**: un solo modelo (`Promotion`) cubre los 10 tipos con sub-objetos por tipo; `app/lib/promotionEngine.server.ts` evalúa "por requisito" contra el carrito real.
- **Lealtad**: `User.loyaltyCycleCount`/`loyaltyCyclesCompleted`/`loyaltyPendingReward` — nunca un descuento permanente, se gana para la siguiente compra y se reinicia el ciclo (ver `app/lib/loyalty.ts`).

---

## 🔑 Variables de entorno

Copia `.env.example` a `.env` y llena:

- `MONGODB_URI` — para desarrollo local: `mongodb://127.0.0.1:27018/stopee_dev`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` — de tu cuenta de Stripe (modo prueba para desarrollar)
- `STRIPE_PRICE_*` — IDs de precios creados en el Dashboard de Stripe para cada producto/paquete/suscripción
- `SESSION_SECRET` — cualquier cadena larga y aleatoria
- `PORT` — puerto fijo del servidor (4827 en desarrollo); `APP_URL` — `http://localhost:4827` en desarrollo (debe coincidir con `PORT`)
- `ADMIN_EMAIL` — correo de respaldo para los avisos del formulario de contacto (ya no otorga permisos de administrador)
