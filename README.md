# FogonClick

## Descripcion general

FogonClick es un sistema web para apoyar la operacion integral de un restaurante. El sistema incluye inicio de sesion por roles, administracion de empresa, empleados, proveedores, insumos, categorias, productos y recetas, caja, pedidos para cocina, pagos mediante QR con Factus Pay y facturacion electronica con Factus.

La aplicacion utiliza Node.js y Express en el servidor, HTML5, CSS3 y JavaScript en la interfaz, Socket.IO para comunicacion en tiempo real, Nodemailer para el envio de correos y PostgreSQL administrado mediante Supabase. El codigo esta organizado por capas con una arquitectura MVC: modelos, controladores, rutas, middlewares, servicios integrados en los controladores cuando corresponde y archivos de interfaz en `vistas/`.

## Equipo

- Juan Andres Rodriguez Achuri - 20242578062
- Matteo Figueroa Mendez - 20242578021
- Karol Sofia Fonseca - 20242578063
- Joan Esteban Abello - 2042578187

## Enlaces de referencia

- Despliegue web: [https://fogonclick.onrender.com/](https://fogonclick3.onrender.com/). El proyecto se encuentra desplegado en Render. El envio de facturas por correo mediante SMTP de Gmail funciona principalmente en el entorno local con una contrasena de aplicacion; el plan gratuito de Render puede limitar o bloquear conexiones SMTP salientes y no debe considerarse equivalente al entorno local para esta funcion.
- Mockup: [prototipo de FogonClick en Figma](https://www.figma.com/proto/wYmLu5ZZPRazqMDdFEjhGG/FogonClick?node-id=8-205&p=f&t=TslN4fBRyVXQQlnY-1&scaling=min-zoom&content-scaling=fixed&page-id=0%3A1&starting-point-node-id=8%3A2)
- Video: [presentacion de FogonClick en YouTube](https://youtu.be/Fb_p4ejBBY0)

## Contexto y alcance del proyecto

El proyecto surgio inspirado en un amigo que queria emprender en el sector de comida rapida. La idea es reducir los tiempos y costos que se producen entre solicitar la cuenta, realizar el pago y recibir la factura electronica.

La primera version fue desarrollada como un prototipo de aproximadamente 24 horas para una hackathon de APIs, con la posibilidad de evolucionar hacia un modelo SaaS para restaurantes. La version actual es una demo academica y funcional; por esa razon conserva margen de optimizacion en seguridad, observabilidad, escalabilidad, configuracion de despliegue y pruebas automatizadas.

## Flujo principal del MVP

1. **Carrito:** el usuario selecciona productos desde el panel de Caja.
2. **Escaneo y pago:** el sistema genera un codigo QR dinamico mediante Factus Pay. En pruebas puede utilizarse el simulador de Factus Pay: [https://pay-api-sandbox.factus.com.co/simulator](https://pay-api-sandbox.factus.com.co/simulator).
3. **Validacion y facturacion:** al confirmarse el pago, la aplicacion valida la operacion, genera la factura electronica mediante Factus y la somete al flujo de validacion de la DIAN gestionado por Factus.
4. **Entrega:** cuando se solicita, el comprobante se envia automaticamente al correo del cliente mediante SMTP.

## Requisitos

- Git.
- Node.js 20.6 o posterior. Esta version es necesaria para utilizar el comando `node --env-file=.env` empleado por el script real de inicio.
- npm, incluido con Node.js.
- Un editor de codigo, por ejemplo Visual Studio Code.
- Una cuenta y un proyecto de Supabase con una base de datos PostgreSQL accesible.
- Credenciales de Factus, Factus Pay y, si se requiere envio de correo, una cuenta de Gmail con contrasena de aplicacion.

No es necesario instalar XAMPP, Apache, MySQL ni PostgreSQL de forma local para la base de datos, porque la aplicacion se conecta a PostgreSQL en Supabase por internet. La carpeta esta ubicada bajo `C:\xampp\htdocs\Restaurante1.1`, pero el servidor se ejecuta con Node.js y no depende de Apache ni de XAMPP.

## Instalacion y ejecucion

Desde la raiz del proyecto, es decir, `C:\xampp\htdocs\Restaurante1.1`:

```text
git --version
node --version
npm --version
```

Si el proyecto se obtiene desde un repositorio, se puede clonar con Git. Tambien puede extraerse desde un archivo ZIP y abrir la carpeta resultante en el editor.

Instalar las dependencias usando el archivo de bloqueo disponible:

```text
npm ci
```

Si se esta reconstruyendo el proyecto desde cero y no existe `package.json`, se puede usar `npm init -y`. En el repositorio actual no es necesario hacerlo: las dependencias ya estan declaradas en `package.json`, entre ellas `express`, `pg`, `socket.io`, `nodemailer`, `dotenv`, `bcryptjs` y `cors`. Si no existe un archivo de bloqueo, puede utilizarse `npm install` en lugar de `npm ci`.

Crear `.env` en la raiz, junto a `servidor.js` y `package.json`. El repositorio actual no contiene `.env.example`; por tanto, las variables deben configurarse a partir de la documentacion y de las credenciales entregadas por el equipo. No se deben publicar valores reales en Git ni en este README.

Iniciar el servidor:

```text
npm start
```

El script real de `package.json` ejecuta `node --env-file=.env servidor.js`. El puerto predeterminado es `3000`, salvo que se configure `PORT`. Para detener el servidor, usar `Ctrl + C`.

## Uso del ambiente compartido del equipo

1. Obtener el proyecto por clonacion o ZIP.
2. Crear el archivo `.env` en la raiz con las credenciales compartidas por el equipo.
3. Ejecutar `npm ci`.
4. Ejecutar `npm start`.
5. Probar el sistema en `http://localhost:3000/` o en el puerto configurado.

Al usar el ambiente compartido no se debe ejecutar nuevamente el DDL desde cero ni volver a sembrar datos sobre la base de datos compartida. Tampoco se deben modificar las credenciales, eliminar registros, cambiar catalogos o probar flujos destructivos sin coordinacion con el equipo. La base de datos compartida debe conservar su estructura y sus datos de trabajo.

## Ambiente independiente opcional

Para crear un ambiente propio:

1. Crear un proyecto independiente en Supabase.
2. Ejecutar el script real `Documentos/DDL.sql` en el SQL Editor de ese proyecto. En la version actual no existe `Documentos/Bd.sql`; cualquier referencia a ese nombre corresponde a una etapa anterior.
3. Verificar las tablas, catalogos iniciales, secuencias, llaves foraneas, restricciones, la vista y el trigger creados por el DDL.
4. Configurar `DATABASE_URL`, `SUPABASE_URL`, las llaves publica y secreta y las credenciales opcionales de Factus, Factus Pay y Gmail.
5. Revisar la secuencia y el identificador de empresa solo si el ambiente requiere datos iniciales propios; no se debe asumir un ID fijo sin comprobar la base de datos.
6. Ejecutar el flujo de registro para crear la empresa y el administrador inicial, o cargar datos base de forma controlada.
7. Ejecutar `npm ci` y `npm start`.

## Variables de entorno

La siguiente tabla describe las variables que utiliza el codigo actual o que son compatibles con sus valores alternativos. Los valores deben permanecer privados.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Cadena principal de conexion PostgreSQL usada por `pg` para Supabase. |
| `SUPABASE_DB_URL` | Nombre alternativo aceptado por el modulo de conexion. |
| `SUPABASE_DATABASE_URL` | Segundo nombre alternativo aceptado por el modulo de conexion. |
| `SUPABASE_URL` | URL del proyecto Supabase para operaciones de autenticacion REST. |
| `SUPABASE_PUBLISHABLE_KEY` | Llave publica de Supabase usada por la autenticacion. |
| `SUPABASE_ANON_KEY` | Fallback compatible para la llave publica si no se usa `SUPABASE_PUBLISHABLE_KEY`. |
| `SUPABASE_SECRET_KEY` | Llave secreta de Supabase para operaciones del servidor. |
| `FACTUS_BASE_URL` | URL base de la API de facturacion de Factus. |
| `FACTUS_CLIENT_ID` | Identificador de cliente OAuth de Factus. |
| `FACTUS_CLIENT_SECRET` | Secreto de cliente OAuth de Factus. |
| `FACTUS_USERNAME` | Usuario de Factus. |
| `FACTUS_PASSWORD` | Contrasena de Factus. |
| `FACTUS_NUMBERING_RANGE_ID` | Rango de numeracion de Factus, cuando el ambiente lo requiere. |
| `FACTUS_PAY_BASE_URL` | URL base de Factus Pay. |
| `FACTUS_PAY_EMAIL` | Correo de la cuenta de Factus Pay. |
| `FACTUS_PAY_PASSWORD` | Contrasena de la cuenta de Factus Pay. |
| `GMAIL_EMAIL` | Cuenta de Gmail usada por Nodemailer como remitente. |
| `GMAIL_APP_PASSWORD` | Contrasena de aplicacion de Gmail usada por SMTP. |
| `PORT` | Puerto HTTP del servidor; si no se define, la aplicacion usa `3000`. |
| `NODE_ENV` | Entorno de ejecucion, por ejemplo `development` o `production`. |
| `ALLOW_LOCAL_AUTH_BYPASS` | Variable presente para comportamientos locales de autenticacion; no debe habilitarse en produccion sin entender sus implicaciones. |

Para crear una contrasena de aplicacion de Google se requiere tener activada la verificacion en dos pasos y utilizar [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). La contrasena de aplicacion normalmente tiene 16 caracteres. No se debe usar la contrasena personal de Gmail en el archivo `.env`.

## Credenciales de prueba

Estas credenciales corresponden al ambiente de demostracion indicado por el equipo. Su existencia depende de los datos disponibles en la base compartida y no deben reutilizarse en produccion.

| Rol | Correo | Contrasena |
| --- | --- | --- |
| Administrador | `admin@gmail.com` | `123456` |
| Administrador alternativo, si esta creado | `juan.achuri010@gmail.com` | `123456` |
| Caja | `caja@gmail.com` | `123456` |
| Cocina o cocinero | `cocina@gmail.com` | `123456` |

## Arquitectura y rutas

El proyecto aplica una arquitectura MVC y separa la responsabilidad de cada capa:

- `modelos/`: acceso a PostgreSQL mediante `pg`, consultas SQL explicitas parametrizadas y transacciones. Aqui viven las operaciones de autenticacion, catalogos, inventario, recetas, pedidos, pagos, facturas y reportes.
- `controladores/`: recibe solicitudes HTTP, valida datos, coordina modelos, servicios externos y respuestas JSON. Tambien contiene los controladores de los modulos de administrador, caja, cocina y autenticacion.
- `rutas/`: registra las rutas de Express y aplica middlewares de autenticacion y de rol.
- `middlewares/`: autenticacion, autorizacion por rol y validaciones transversales.
- `vistas/`: paginas HTML, CSS y JavaScript del navegador. Los scripts del frontend estan en `vistas/scripts/`.
- `Reportes/`: pagina y estilos del modulo de reportes y chat.
- `Documentos/`: DDL, planeacion y archivos de apoyo del proyecto.

Las rutas principales registradas en `rutas/api.js` son:

- `/api/auth`: registro, inicio de sesion y recuperacion de acceso.
- `/api/admin`: operaciones administrativas protegidas.
- `/api/caja`: productos, categorias, pedidos, pagos, facturas y operaciones de Caja, protegidas para administracion y Caja.
- `/api/cocina`: consulta y actualizacion de pedidos de Cocina, protegidas para administracion y Cocina.
- `/reportes`: archivos estaticos del modulo de reportes y chat.
- `/`: sirve `vistas/index.html`.

La autenticacion del navegador conserva el token por pestaña mediante `sessionStorage` en `vistas/solicitudAutenticada.js`. El frontend usa `fetch` para consumir el backend y envia el token Bearer en las solicitudes protegidas. Socket.IO se inicializa desde `servidor.js` para los eventos en tiempo real.

## Estructura actual del repositorio

```text
Restaurante1.1/
|-- controladores/
|   |-- administrador.js
|   |-- autenticacion.js
|   |-- caja.js
|   `-- cocina.js
|-- Documentos/
|   |-- DDL.sql
|   |-- ER.drawio.pdf
|   |-- ER.drawio.png
|   |-- Proyecto BDA.pdf
|   |-- RE.drawio.pdf
|   |-- RE.drawio.png
|   |-- Credenciales.txt
|   `-- README.md
|-- middlewares/
|   `-- autenticacion.js
|-- modelos/
|   |-- Admin.js
|   |-- autenticacion.js
|   |-- auxiliares.js
|   |-- baseDatos.js
|   |-- caja.js
|   `-- cocina.js
|-- Reportes/
|   |-- Chat.html
|   `-- styles.css
|-- rutas/
|   `-- api.js
|-- vistas/
|   |-- administrador.html
|   |-- cajero.html
|   |-- cocina.html
|   |-- index.html
|   |-- aplicacion.js
|   |-- notificaciones.js
|   |-- personalizacion.js
|   |-- solicitudAutenticada.js
|   |-- Style.css
|   |-- Personalizacion.css
|   |-- Medios/
|   |-- facturas/
|   `-- scripts/
|       |-- administrador.js
|       |-- cajero.js
|       `-- cocinero.js
|-- .env
|-- package.json
|-- package-lock.json
`-- servidor.js
```

La carpeta real de documentacion se llama `Documentos` con D mayuscula. La carpeta real de reportes se llama `Reportes` con R mayuscula. Los nombres de archivos y referencias deben conservar exactamente este casing para funcionar en sistemas Linux como Render.

## Orden recomendado de operacion

El flujo de configuracion de datos debe seguir este orden logico:

1. Registrar o configurar el proveedor.
2. Registrar los insumos. Los insumos normales se consumen por medio de recetas; los insumos directos representan productos que pueden venderse directamente y se registran con su producto y receta asociada segun las reglas del sistema.
3. Registrar las categorias y los productos.
4. Crear las recetas y asociar sus insumos y cantidades.
5. Ejecutar el flujo de venta, cobro, validacion del pago y facturacion.

Este orden permite que las llaves foraneas y las validaciones de inventario encuentren los catalogos y relaciones necesarios.

## Base de datos y configuracion tecnica

La estructura base se encuentra en `Documentos/DDL.sql`. El servidor usa `pg` en `modelos/baseDatos.js`, toma la cadena PostgreSQL desde `DATABASE_URL` o sus nombres alternativos, activa SSL cuando la conexion corresponde a Supabase y expone funciones para ejecutar SQL parametrizado y transacciones `BEGIN`, `COMMIT` y `ROLLBACK`.

La autenticacion de usuarios utiliza la URL y las llaves configuradas de Supabase. Las operaciones de negocio de la aplicacion se ejecutan desde los modelos mediante SQL explicito; los controladores no deben contener consultas SQL directas. Las llamadas HTTP externas quedan reservadas para Factus, Factus Pay y los servicios de correo.

## Notas importantes

- En el registro de empresa y administrador se deben diferenciar el telefono de la empresa y el telefono personal del administrador.
- La tabla de empresa es necesaria para construir los datos fiscales y comerciales enviados a Factus, incluyendo identificacion, razon social, direccion, municipio, departamento, correo y telefono.
- Socket.IO permite actualizar pedidos y estados de Cocina y Caja en tiempo real. Si los eventos no se reflejan, revisar que el servidor este iniciado y que el navegador conserve una sesion valida.
- La recuperacion de contraseña depende del correo real configurado en Nodemailer. En local se recomienda probar con la cuenta Gmail y su contrasena de aplicacion configuradas en `.env`.
- No se deben compartir contraseñas, llaves de Supabase, secretos de Factus ni contraseñas de aplicacion. Un cambio de credenciales puede alterar la base compartida o bloquear el correo.
- En despliegues Linux se deben respetar mayusculas y minusculas en `Documentos`, `Reportes`, `vistas`, `modelos`, `controladores`, `rutas` y en todos los imports.
- La aplicacion actual inicia con `servidor.js`; las instrucciones antiguas que mencionen `server.js` deben interpretarse como una referencia de una etapa anterior.
- No existe configuracion especifica de Vercel en el repositorio actual. La aplicacion es un servidor Express persistente y su comando de despliegue natural es el mismo proceso Node utilizado en Render.

## Resolucion de problemas frecuentes

### El servidor no inicia

Verificar que la version de Node sea 20.6 o posterior, que `.env` este en la raiz, que `DATABASE_URL` sea valida y que se haya ejecutado `npm ci`. Revisar tambien que el puerto configurado no este ocupado.

### No se conecta a Supabase

Comprobar `DATABASE_URL`, `SUPABASE_URL` y las llaves de Supabase. Confirmar que el proyecto de Supabase este activo, que el servidor pueda salir a internet y que la conexion PostgreSQL permita SSL cuando corresponde.

### No aparecen productos, pedidos o estados

Revisar la sesion de la pestaña, el rol asignado al empleado, las rutas `/api/caja` y `/api/cocina`, la consola del navegador y los registros del servidor. Confirmar que las tablas y catalogos del DDL existan y que no se haya ejecutado un filtro con una categoria o estado inexistente.

### Factus rechaza una factura

Comprobar las credenciales, `FACTUS_BASE_URL`, el rango de numeracion, los datos fiscales de la empresa, el municipio, los impuestos, el metodo de pago y los datos del cliente. Si no se registra un cliente, la aplicacion utiliza el flujo de consumidor final definido por el proyecto y debe poder consultar el registro correspondiente en la base.

### No se envia la factura por correo

Verificar `GMAIL_EMAIL` y `GMAIL_APP_PASSWORD`, que la contrasena de aplicacion siga activa y que el entorno permita conexiones SMTP. En Render Free esta funcion puede estar limitada; se recomienda validarla primero en local y revisar los logs del servidor.

## Contacto

Para dudas sobre el proyecto: `achuri.juan@gmail.com`.
