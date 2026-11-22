# Despliegue de STOPee en Google Cloud Run

Guía paso a paso para publicar el sitio. Los comandos se corren en la terminal con
`gcloud` instalado (https://cloud.google.com/sdk/docs/install) o directamente en
**Cloud Shell** (el botón `>_` de la consola de Google Cloud, no requiere instalar nada).

Piezas del despliegue:

| Pieza | Servicio | Para qué |
|---|---|---|
| Sitio y backoffice | **Cloud Run** | Corre el contenedor (`Dockerfile`) |
| Base de datos | **MongoDB Atlas** | Pedidos, catálogo, clientes, textos |
| Imágenes, videos y PDF subidos | **Cloud Storage** | El disco de Cloud Run se borra en cada reinicio |
| Llaves y contraseñas | **Secret Manager** | Nunca van en el código ni en la imagen |
| Pagos | **Stripe** (modo real) | Checkout, suscripciones y webhook |

Define estas variables en tu terminal para copiar y pegar los comandos (cambia los valores):

```bash
export PROJECT_ID="stopee-prod"          # id único de tu proyecto de Google Cloud
export REGION="northamerica-south1"      # Querétaro; verifica que esté disponible para tu proyecto
export BUCKET="stopee-prod-archivos"     # nombre único global del bucket
export SERVICE="stopee"
```

---

## 1. MongoDB Atlas (base de datos)

1. Crea una cuenta en https://www.mongodb.com/atlas y un clúster en **Google Cloud**, región cercana (Dallas o Querétaro).
2. En *Database Access* crea un usuario con una contraseña larga y aleatoria (solo lectura/escritura sobre la base `stopee`).
3. En *Network Access* hay que permitir que Cloud Run se conecte. Cloud Run no tiene una IP fija, así que lo más simple es permitir `0.0.0.0/0` — es seguro **solo si** la contraseña del usuario es larga y única. (La alternativa con IP fija requiere una red VPC y Cloud NAT, y cuesta unos USD 30 al mes.)
4. Copia la cadena de conexión (`mongodb+srv://usuario:CONTRASEÑA@cluster.../stopee`). Será el secreto `MONGODB_URI`.

## 2. Proyecto de Google Cloud

```bash
gcloud auth login
gcloud projects create $PROJECT_ID           # o usa uno existente
gcloud config set project $PROJECT_ID
# Vincula una cuenta de facturación al proyecto desde la consola (Billing).

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com
```

## 3. Bucket de archivos subidos

```bash
gcloud storage buckets create gs://$BUCKET --location=$REGION --uniform-bucket-level-access

# Lectura pública: las fotos y el PDF de la ficha técnica se muestran a cualquier visitante.
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member=allUsers --role=roles/storage.objectViewer
```

> Si Google rechaza el acceso público, tu organización tiene activada la política
> "Prevención de acceso público". Se desactiva para este bucket desde
> *Cloud Storage → Bucket → Permisos*.

## 4. Secretos

Crea cada uno (el valor entra por la entrada estándar para que no quede en el historial):

```bash
printf '%s' 'mongodb+srv://...'      | gcloud secrets create mongodb-uri          --data-file=-
printf '%s' 'sk_live_...'            | gcloud secrets create stripe-secret-key    --data-file=-
printf '%s' 'whsec_...'              | gcloud secrets create stripe-webhook-secret --data-file=-
printf '%s' "$(openssl rand -hex 48)" | gcloud secrets create session-secret       --data-file=-
printf '%s' 'xkeysib-...'            | gcloud secrets create brevo-api-key         --data-file=-
```

(`whsec_...` lo obtienes en el paso 7; puedes crear ese secreto después y volver a desplegar.)

Dale permiso a Cloud Run para leerlos y para subir archivos al bucket:

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$RUN_SA" --role=roles/secretmanager.secretAccessor
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="serviceAccount:$RUN_SA" --role=roles/storage.objectAdmin
```

## 5. Primer despliegue

Desde la carpeta del proyecto. Cloud Build construye la imagen con el `Dockerfile`:

```bash
gcloud run deploy $SERVICE \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 \
  --min-instances 0 --max-instances 1 \
  --cpu-boost \
  --timeout 300 \
  --set-env-vars "GCS_BUCKET=$BUCKET,ADMIN_EMAIL=limpiador.stopee@gmail.com,MAIL_FROM_EMAIL=hola@stopee.com.mx,MAIL_FROM_NAME=STOPee,APP_URL=https://temporal.invalid" \
  --set-secrets "MONGODB_URI=mongodb-uri:latest,STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest,SESSION_SECRET=session-secret:latest,BREVO_API_KEY=brevo-api-key:latest"
```

Al terminar, el comando imprime la URL del servicio (`https://stopee-xxxxx.a.run.app`).
Ponla como `APP_URL` (o tu dominio final, ver paso 6):

```bash
gcloud run services update $SERVICE --region $REGION \
  --update-env-vars "APP_URL=https://stopee-xxxxx.a.run.app"
```

Por qué esos números:

- `--min-instances 0`: modo ahorro para el pre-lanzamiento. Si nadie visita el sitio, Google apaga la copia y no cobra; con poco tráfico el costo de Cloud Run suele quedar dentro de la capa gratuita. A cambio, la primera visita después de un rato sin tráfico espera unos segundos mientras la copia arranca (Stripe reintenta solo si un webhook llega en ese momento). `--cpu-boost` acorta esa espera.
- **Cuando empieces a vender**, pasa a una copia siempre encendida (unos USD 10–15 al mes) para que nadie espere:

  ```bash
  gcloud run services update $SERVICE --region $REGION --min-instances 1
  ```

- `--max-instances 1`: el límite de intentos (contraseña de acceso privado, checkout, login) se cuenta en la memoria de cada instancia. Con varias copias se volvería más flojo. Con `min-instances 0` el contador también se reinicia cuando la copia se apaga por inactividad, lo cual no abre ningún hueco: un ataque sostenido mantiene la copia encendida. Cuando el tráfico lo justifique, sube el máximo a 2 o 3 sabiendo eso.
- **Videos:** Cloud Run acepta peticiones de hasta **32 MB**. Fotos y PDF caben sin problema; para videos usa el enlace de YouTube (ya soportado) o súbelos comprimidos.

## 6. Dominio propio

1. Verifica el dominio en https://search.google.com/search-console.
2. Mapéalo al servicio (en regiones donde esté disponible):

```bash
gcloud beta run domain-mappings create --service $SERVICE --domain www.stopee.com.mx --region $REGION
```

Te devuelve los registros DNS que debes agregar donde compraste el dominio. Si esa región no admite
mapeo de dominios, la alternativa es un Balanceador de carga global de Google con certificado administrado
(se configura desde *Network Services → Load balancing*).

Cuando el dominio funcione, actualiza `APP_URL` con él (comando del paso 5).

## 7. Stripe en modo real

1. En el panel de Stripe activa tu cuenta (datos fiscales y bancarios) y cambia a **modo real** (*Live*).
2. Copia la llave secreta real (`sk_live_...`) y guárdala como secreto `stripe-secret-key`
   (`gcloud secrets versions add stripe-secret-key --data-file=-`).
3. *Developers → Webhooks → Add endpoint*: URL `https://TU-DOMINIO/webhooks/stripe`, con los eventos:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.async_payment_succeeded` y `checkout.session.async_payment_failed` (pagos diferidos: OXXO, transferencia)
   - `charge.refunded` (marca el pedido como reembolsado)
   - `charge.dispute.created` e `invoice.payment_failed` (solo dejan un aviso en los registros de Cloud Run)
4. Copia el *signing secret* (`whsec_...`) al secreto `stripe-webhook-secret`.
5. Aplica los cambios: `gcloud run services update $SERVICE --region $REGION --update-secrets "STRIPE_SECRET_KEY=stripe-secret-key:latest,STRIPE_WEBHOOK_SECRET=stripe-webhook-secret:latest"`.

## 7b. Correos con Brevo

El sitio envía estos correos: aviso al negocio cuando alguien llena **Contacto**, bienvenida a quien se
registra en la **lista de espera**, aviso al cliente cuando un pedido pasa a **En tránsito** o se captura
su número de guía, y los tres de la cuenta: **confirmar correo** (al registrarse), **restablecer contraseña**
(enlace de 1 hora) y **aviso de contraseña cambiada**. Si Brevo no está configurado, todo lo demás funciona y
solo se omiten los correos; **pero sin Brevo nadie podría recuperar su contraseña**, así que configúralo antes
de lanzar. Los enlaces de los correos se arman con `APP_URL`: debe ser el dominio final (`https://stopee.com.mx`).

1. Crea la cuenta en https://app.brevo.com (el plan gratuito permite 300 correos al día).
2. **Remitente.** En *Remitentes, dominios e IP*, autentica el dominio `stopee.com.mx`: Brevo te da registros DNS
   (DKIM, y el de verificación de Brevo) que agregas donde compraste el dominio. Además agrega o revisa un registro
   SPF y uno DMARC. Sin autenticar el dominio, los correos caen en spam o Brevo los rechaza. Mientras el dominio
   se verifica puedes usar una dirección individual (por ejemplo tu Gmail) como remitente de prueba.
3. **Llave de API.** *SMTP y API → Llaves API → Generar* (versión v3). Guárdala como el secreto `brevo-api-key`
   del paso 4 (o con `gcloud secrets versions add brevo-api-key --data-file=-`).
4. **Direcciones IP autorizadas.** En *Seguridad → Direcciones IP autorizadas* de Brevo, si la restricción está
   activa, desactívala: Cloud Run no tiene una IP fija y Brevo rechazaría todos los envíos.
5. `MAIL_FROM_EMAIL` debe ser exactamente el remitente verificado. El aviso de contacto llega al correo que
   capturaste en **Datos del negocio** (campo de correo de contacto); si está vacío, no se envía.
6. Si Brevo rechaza un envío, el motivo queda en los registros de Cloud Run (busca `mail.send`).

## 8. Primer administrador

1. Entra a `https://TU-DOMINIO/cuenta/registro` y crea tu cuenta con tu correo y una contraseña larga.
   Haz esto **antes de dar a conocer la dirección del sitio**.
2. Conviértela en **super administradora** desde tu computadora, apuntando a la base de producción
   (la cuenta ya no se promueve sola por el correo de `ADMIN_EMAIL`, para que nadie más pueda registrarse
   primero con ese correo y quedarse con el panel):
   ```bash
   MONGODB_URI="mongodb+srv://usuario:CONTRASEÑA@cluster.../stopee" npm run make-admin -- tu-correo@ejemplo.com
   ```
   Después inicia sesión en `/admin/login`. El acceso al panel caduca a las 8 horas y vuelve a pedir contraseña.

   **Roles.** El *super administrador* (solo se otorga con este comando) puede, desde **Clientes → Nuevo usuario**,
   crear cuentas de cliente o de administrador y cambiar el rol de una cuenta existente. El *administrador*
   gestiona catálogo, pedidos, promociones y clientes, pero no crea administradores ni cambia roles. Si ya tenías
   una cuenta con el rol anterior de "admin", sigue funcionando como administrador; corre este comando con tu
   correo para convertirla en super administradora. Para quitarle el acceso a alguien: cambia su rol a Cliente
   desde su perfil (o `--revoke` desde la terminal).
   **Verificación en dos pasos (obligatoria en el panel).** Además de la contraseña, todo administrador necesita
   un código de 6 dígitos de una app (Google Authenticator, 1Password, Authy…). La primera vez que alguien con
   rol de administrador entra a `/admin/login`, el panel lo lleva a **activarla** (escanear un QR y confirmar con un
   código; toma 2 minutos) y le entrega **10 códigos de recuperación**, de un solo uso, que debe guardar. Hasta
   activarla no se abre ninguna pantalla del panel. Se administra en **Seguridad** (menú del panel).
   - *Perdió el celular:* entra con un código de recuperación (`/admin/verificar` → "No tengo mi celular").
   - *Perdió también los códigos:* quien tenga acceso a la base lo reinicia desde la terminal, y la persona
     vuelve a activarla en su siguiente entrada:
     ```bash
     MONGODB_URI="mongodb+srv://usuario:CONTRASEÑA@cluster.../stopee" npm run reset-2fa -- correo@ejemplo.com
     ```
   - No existe un botón para apagarla desde el panel, a propósito: una sesión robada podría usarlo.
   - Los secretos se guardan **cifrados con una llave derivada de `SESSION_SECRET`**. Si algún día rotas
     `SESSION_SECRET`, los códigos del celular dejan de validar (los de recuperación siguen sirviendo) y hay
     que correr `reset-2fa` por cada administrador. Plánéalo junto con la rotación.
   **Correo confirmado para entrar.** Nadie inicia sesión (ni en la tienda ni en el panel) sin haber confirmado
   su correo con el enlace que llega al crear la cuenta; en el login aparece un botón "Reenviar enlace". Por eso
   el correo de Brevo (sección 7b) tiene que funcionar antes de abrir el registro. `make-admin` marca el
   correo como confirmado, así que quien reciba el rol de esa forma nunca queda fuera. Si alguna vez una cuenta
   vieja se queda sin confirmar y sin acceso: usa "¿Olvidaste tu contraseña?" (restablecer la contraseña
   también confirma el correo) o, como último recurso, pon `emailVerifiedAt` con la fecha de hoy en su documento
   de la colección `users` desde Atlas.
3. Llena **Datos del negocio**, catálogo, envíos, banners y testimonios.
4. Mientras la tienda esté en pre-lanzamiento, el público solo ve el landing, el blog, "Cómo funciona" y "Nosotros". Tú ves la tienda completa con tu sesión.

### Llevar tus datos de desarrollo a producción (opcional)

Si quieres conservar lo que ya capturaste en tu base local, exporta e importa:

```bash
mongodump --uri="mongodb://127.0.0.1:27018/stopee_dev" --out=./dump
mongorestore --uri="mongodb+srv://usuario:CONTRASEÑA@cluster.../stopee" --nsFrom='stopee_dev.*' --nsTo='stopee.*' ./dump/stopee_dev
```

Ojo: las imágenes de tu computadora (`public/uploads`) **no viajan con la base de datos** y sus
direcciones empiezan con `/uploads/…`. Hay que subirlas al bucket y actualizar esas direcciones, o volver
a subirlas desde el backoffice en producción. Pídeme el script de migración si lo necesitas.

## 9. Lanzamiento

1. Revisa en producción, con tu sesión de administrador: tienda, carrito, un pedido de prueba real de bajo monto, el correo del webhook, envíos por código postal.
2. Cuando todo esté bien, activa la tienda en **Configuración** del backoffice.
3. Haz el primer reembolso de prueba desde Stripe para confirmar el flujo completo.

## Actualizar el sitio después

Cada cambio de código se publica con el mismo comando del paso 5 (sin repetir los secretos: Cloud Run
conserva la configuración del servicio):

```bash
gcloud run deploy $SERVICE --source . --region $REGION
```

Para volver a una versión anterior: *Cloud Run → servicio → Revisiones → Administrar tráfico*.

## Qué NO está resuelto todavía

- **Correo de confirmación de compra:** el sitio manda «Recibimos tu pedido» al registrarse el pago. Además, Stripe puede enviar su propio recibo (*Configuración → Correos de clientes*, activar «Recibos de pago»). Las renovaciones del auto-envío todavía no mandan confirmación propia.
- **Envío recurrente de suscripciones:** el costo de envío de las cajas periódicas quedó pendiente.
- **Paquetería real:** los envíos se calculan por zonas de código postal, no con una guía de paquetería.
- **Respaldos:** Atlas los hace automáticamente en planes de pago; en el plan gratuito, conviene programar `mongodump` periódicos.
- **Varias instancias:** si algún día subes `--max-instances`, el límite de intentos deja de ser global (ver paso 5).
