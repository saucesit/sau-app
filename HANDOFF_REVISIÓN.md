# Handoff para revisión técnica — SAU

Documento preparado para un revisor externo. **No modifica código, esquema ni datos.**
Fecha del relevamiento: **22 de septiembre de 2026**.

---

## 0. Estado del repositorio

| | |
|---|---|
| Ruta local | `D:\Users\Usuario\Desktop\IA\sau-app` |
| Remoto | `https://github.com/saucesit/sau-app.git` |
| Rama actual | `master` |
| Último commit | `704a5a7` — *fix: mostrar las tareas del taller solo a las empresas con el módulo activo* |
| Sincronía | `master` local y `origin/master` están al día (push hecho hoy) |

### Cambios sin guardar

Uno solo, y es ruido de herramienta:

```
 M supabase/.temp/cli-latest
```

Es el archivo donde el CLI de Supabase cachea el número de su última versión. **No hay cambios de código ni de esquema sin commitear.**

### Ramas

- `master` — rama de trabajo y la que publica Vercel
- `feat/modulo-taller` — ya mergeada a `master`, se puede borrar
- `respaldo/2026-06-15` — respaldo viejo, también en el remoto

---

## 1. Tecnología

**Frontend**

- React 19 + Vite 8, JavaScript (no TypeScript)
- React Router 7
- Tailwind CSS 4 (vía `@tailwindcss/vite`)
- `lucide-react` (íconos), `jspdf` (generación de PDF de presupuestos)
- ESLint 10 configurado en `eslint.config.js`

**Backend**

- Supabase: Postgres, Auth, Storage y Edge Functions (Deno)
- Las Edge Functions llaman a la API de Anthropic para el módulo de agente IA

**Deploy**

- Vercel, publicando desde `master`
- `vercel.json` reescribe todas las rutas a `/index.html` (SPA)

**Advertencias para el revisor**

- El `name` de `package.json` sigue siendo `kiosco-carlitos`, de cuando el proyecto era un prototipo para otro cliente. Es cosmético pero confunde.
- **No hay tests** de ningún tipo en el repositorio.
- El bundle principal pesa ~1,25 MB sin comprimir (~342 kB gzip) y Vite ya avisa que conviene dividirlo.

---

## 2. Cómo levantarlo localmente

```bash
npm install
cp .env.example .env.local   # completar con las credenciales del proyecto Supabase
npm run dev
```

Scripts disponibles: `dev`, `build`, `preview`, `lint`.

### Variables de entorno

`.env.local` está en `.gitignore` (la regla es `.env*`) y **no se versiona**. El archivo `.env.example`, que sí está en el repo, declara únicamente los nombres:

```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-public-key
```

Las credenciales reales están en `.env.local` en la máquina del desarrollador y en las variables de entorno de Vercel. **No se incluyen en este documento.**

El `service_role_key` nunca aparece en el frontend: solo lo usan las Edge Functions, que lo leen del entorno de Supabase.

---

## 3. Estructura de carpetas

```
sau-app/
├── src/
│   ├── AppRouter.jsx          # rutas y guardas de acceso
│   ├── main.jsx               # punto de entrada
│   ├── App.jsx                # prototipo viejo de fiado, se conserva en /prototipo
│   ├── components/
│   │   └── Layout.jsx         # header, tab bar inferior y filtrado de pestañas
│   ├── context/
│   │   └── AuthContext.jsx    # sesión, membresías, permisos y módulos
│   ├── lib/
│   │   ├── supabase.js        # cliente
│   │   ├── constants.js       # catálogo de permisos
│   │   ├── modulos.js         # catálogo de módulos ("chaleco de bolsillos")
│   │   ├── taller.js          # reglas del módulo taller
│   │   ├── format.js
│   │   └── pdfPresupuesto.js
│   └── pages/                 # 33 pantallas
└── supabase/
    ├── migrations/            # 25 archivos SQL, 0001 a 0025
    └── functions/             # 11 Edge Functions
```

### Modelo de acceso: el "chaleco de bolsillos"

Dos capas independientes, y hay que entender las dos para leer el código:

1. **Módulo** — qué funcionalidades tiene contratada la *empresa* (`empresa.modulos_activos`). Definidos en `src/lib/modulos.js`.
2. **Permiso** — qué puede hacer cada *persona* dentro de esos módulos (`membresia.permisos`, un array de texto). Definidos en `src/lib/constants.js`.

Una pestaña aparece solo si se cumplen ambas cosas. La lógica está en `Layout.jsx` (`moduloActivo` + `tienePermiso`).

---

## 4. Integración con Supabase

- Cliente único en `src/lib/supabase.js`, instanciado con la URL y la anon key.
- `AuthContext.jsx` mantiene la sesión y, al iniciar, trae las membresías del usuario con la empresa embebida:
  `membresia → (id, rol, permisos, empresa_id, empresa:empresa_id(*))`
- Toda lectura y escritura del frontend va por PostgREST con la anon key, sujeta a RLS.
- Las operaciones que requieren privilegios (crear usuarios, resetear claves, llamar a Anthropic) pasan por Edge Functions con `service_role`.

### Edge Functions

| Función | Para qué |
|---|---|
| `chat-agente` | Arma el system prompt desde `agente_config.config` y conversa con Claude; guarda caso y mensajes |
| `whatsapp-webhook` | Recibe webhooks de Meta Cloud API, rutea al agente y responde por WhatsApp |
| `crear-cliente` | Alta de empresa + usuario dueño (lo usa el panel de admin) |
| `crear-empleado` | Alta de empleado con permisos |
| `usuarios-empresa` | Gestión de usuarios de una empresa |
| `resetear-acceso` | Reseteo de contraseña |
| `leer-factura` | OCR/lectura de facturas de compra |
| `solicitar-cae` | Facturación electrónica ARCA |
| `analizar-consulta` / `notificar-consulta` | Leads que llegan por la landing |
| `actividad-fiado` | Resumen de movimientos de fiado |

---

## 5. Tablas

La base tiene **32 tablas** en `public`, **todas con RLS habilitada**, y 3 vistas fiscales
(`libro_iva_compras`, `libro_iva_ventas`, `posicion_iva_mensual`).

### Núcleo

| Tabla | Para qué |
|---|---|
| `empresa` | El cliente de SAU. Contiene `modulos_activos` |
| `profile` | Perfil del usuario, con las banderas `es_sau_admin` y `es_sau_contadora` |
| `membresia` | Une usuario ↔ empresa, con `rol` y el array `permisos` |

### Operación comercial

`venta`, `movimiento_caja`, `compra`, `gasto`, `proveedor`, `producto`, `movimiento_stock`,
`cliente_fiado`, `movimiento_fiado`, `presupuesto`, `presupuesto_item`, `plantilla_presupuesto`,
`catalogo_item`, `pedido`, `reserva`, `certificado_arca`, `pago_abono`, `tarea_contadora`,
`consulta_sau`, `leads_nico`, `cliente_nota`.

### Agente IA

| Tabla | Para qué |
|---|---|
| `agente_config` | Nombre, número, estado y el "cerebro" del agente en un JSONB |
| `agente_credenciales` | Tokens del proveedor. RLS habilitada y **sin policies**: solo accesible con `service_role` |
| `caso` | La conversación como registro estructurado |
| `caso_mensaje` | Transcript completo, mensaje por mensaje |

### Módulo taller (migración 0025, la más reciente)

| Tabla | Filas hoy | Para qué |
|---|---|---|
| `vehiculo` | 12 | Ficha del vehículo: datos, compañía, siniestro, etapa actual, excepción |
| `vehiculo_monto` | 12 | Montos y validaciones de cobro, **en tabla aparte a propósito** (ver §7) |
| `vehiculo_evento` | 16 | Bitácora: ingreso, notas del reporte diario, avances, excepciones, cobros |
| `vehiculo_archivo` | **0** | Fotos y PDFs. Vacía: el flujo de subida nunca se ejecutó |

---

## 6. Migraciones

**29 migraciones, de `0001` a `0029`, todas aplicadas en producción.** No hay ninguna pendiente.

Las más relevantes para esta revisión:

| Archivo | Contenido |
|---|---|
| `0010_modulos.sql` | `modulos_activos` en empresa |
| `0014_sau_admin.sql` | Rol de administrador de SAU |
| `0017_agente.sql` | `agente_config` y `agente_credenciales` |
| `0023_caso.sql` | `caso` y `caso_mensaje` |
| `0024_reserva.sql` | Reservas públicas (transporte) |
| `0025_taller.sql` | **Módulo taller completo** |
| `0026_taller_seguridad.sql` | **Flujo por funciones del servidor**, trigger guardián, montos y bitácora protegidos, storage aislado por empresa |
| `0027_taller_especialidad.sql` | Primera versión de la especialidad del operario (una sola etapa) |
| `0028_taller_etapas_habilitadas.sql` | Etapas habilitadas como lista, fin del modo permisivo, y cobros solo por función |
| `0029_taller_marcado_idempotente.sql` | Un trabajo no se puede marcar dos veces |

### Advertencia importante sobre el proceso

**Las migraciones no se aplican con `supabase db push`.** Se corren a mano, una por una:

```bash
supabase db query --linked -f supabase/migrations/00XX_nombre.sql
```

**No existe tabla de control de migraciones aplicadas.** El orden y el estado se siguen por
convención y por inspección directa de la base. Un revisor **no debe asumir** que el contenido de
`supabase/migrations/` refleja exactamente el esquema vivo: hay que verificarlo contra la base.
Al día de hoy fueron verificadas y coinciden.

---

## 7. RLS y permisos por rol

### Patrón general

Casi todas las tablas usan las funciones auxiliares `empresas_del_usuario()` y
`es_contadora_o_admin()`: se ve lo de la propia empresa, más acceso total para admin y contadora.

### Módulo taller: enfoque distinto y más estricto

El taller **no** usa ese patrón. Usa `tiene_permiso_taller(empresa_id, permiso)`, que replica del
lado del servidor la misma semántica que `tienePermiso()` en el frontend.

```sql
create function tiene_permiso_taller(p_empresa uuid, p_permiso text) returns boolean
  -- contadora y admin pueden todo; el resto depende del array membresia.permisos
```

**Decisión de diseño que el revisor tiene que entender:** los montos viven en `vehiculo_monto`,
una tabla separada, y no como columnas de `vehiculo`. El motivo es que **Postgres no puede ocultar
columnas sueltas con RLS**. Si los montos estuvieran en `vehiculo`, cualquier operario con permiso
de lectura sobre la ficha podría leer los precios consultando la API directamente, por más que la
interfaz los oculte. Separándolos, quien no tiene `taller.montos` recibe cero filas.

### Policies del módulo (10)

| Tabla | Policy | Operación | Requiere |
|---|---|---|---|
| `vehiculo` | `vehiculo_select` | SELECT | `taller.ver` |
| `vehiculo` | `vehiculo_insert` | INSERT | `taller.cargar` |
| `vehiculo` | `vehiculo_update` | UPDATE | `taller.validar` |
| `vehiculo` | `vehiculo_delete` | DELETE | `empresa.admin` |
| `vehiculo_monto` | `vehiculo_monto_select` | SELECT | `taller.montos` |
| `vehiculo_monto` | `vehiculo_monto_write` | ALL | `taller.montos` |
| `vehiculo_evento` | `vehiculo_evento_select` | SELECT | `taller.ver` |
| `vehiculo_evento` | `vehiculo_evento_insert` | INSERT | `taller.ver` |
| `vehiculo_archivo` | `vehiculo_archivo_select` | SELECT | `taller.ver` |
| `vehiculo_archivo` | `vehiculo_archivo_insert` | INSERT | `taller.cargar` |

`vehiculo_evento` y `vehiculo_archivo` **no tienen policies de UPDATE ni DELETE**: la bitácora es
append-only por diseño.

### Permisos y roles del taller

| Perfil | Permisos | Ve montos | Carga | Marca trabajo | Valida y avanza | Borra |
|---|---|---|---|---|---|---|
| Operario | `taller.ver`, `taller.trabajar` | No | No | Sí | No | No |
| Coordinador | + `taller.cargar`, `taller.validar` | No | Sí | Sí | Sí | No |
| Administración | + `taller.montos` | Sí | Sí | Sí | Sí | No |
| Rol completo | todos + `empresa.admin` | Sí | Sí | Sí | Sí | Sí |

Los perfiles se asignan desde la interfaz, en `src/pages/EquipoTareas.jsx`, que traduce permisos
técnicos a lenguaje de negocio.

### El flujo no se toca con UPDATE (migración 0026)

Avance, excepciones, entrega y cobro **no son `UPDATE` desde el navegador**. Son funciones
`security definer` que validan permiso, etapa actual y transición:

| Función | Quién puede | Qué valida |
|---|---|---|
| `taller_marcar_trabajo_hecho(uuid)` | `taller.trabajar` | Etapa con operario, y que coincida con la especialidad si tiene una |
| `taller_validar_avance(uuid)` | `taller.validar` | Que el operario haya marcado el trabajo; avanza **una sola** etapa |
| `taller_cambiar_excepcion(uuid, text)` | `taller.trabajar` o `taller.validar` | Excepción válida; nunca cambia la etapa |
| `taller_entregar(uuid, date)` | `taller.validar` | Solo desde `terminado` |
| `taller_registrar_cobro(uuid, text, bool)` | `taller.montos` | Campo de cobro válido |

El `UPDATE` directo queda para corregir datos del vehículo. Un **trigger guardián**
(`taller_guardia_flujo`) rechaza cualquier cambio a `etapa`, `etapa_desde`, `trabajo_hecho`,
`excepcion`, `excepcion_desde`, `fecha_entrega` o `empresa_id` que no venga de esas funciones, que
levantan una bandera de sesión antes de escribir.

### Etapas habilitadas por operario (migraciones 0027 y 0028)

`membresia.taller_etapas` es la lista de etapas en las que cada persona puede marcar trabajo
realizado: el chapista no puede dar por terminado un auto que está en Pintura, y quien hace chapa y
preparación tiene las dos habilitadas. Se asigna desde `src/pages/EquipoTareas.jsx`.

**La lista vacía no significa "todas": significa ninguna.** Quien tiene `taller.trabajar` y no tiene
etapas cargadas recibe *"Todavía no tenés etapas habilitadas"* al intentar marcar. El permiso solo
no alcanza; hay que configurar el oficio. Por eso, al poner esto en producción **hay que cargarle
las etapas a cada persona del taller antes de que empiecen a usarlo**.

### Acceso de soporte (break-glass)

El personal de SAU — los perfiles con `es_sau_admin` o `es_sau_contadora` — **no tiene membresía en
la empresa del cliente**, y por lo tanto tampoco tiene etapas habilitadas. Si se aplicara la regla
tal cual, quedaría sin poder operar el taller de un cliente para darle soporte.

`tiene_permiso_taller()` les concede todos los permisos, y `taller_marcar_trabajo_hecho()` los exime
de la validación de etapas. En los hechos es un **acceso de emergencia con privilegio máximo sobre
todos los clientes**, decidido a conciencia y aceptado en revisión. Consecuencias que conviene tener
presentes:

- Quien tenga una de esas dos banderas puede marcar trabajo, validar, entregar y ver montos de
  **cualquier** empresa del sistema.
- Las acciones quedan registradas en `vehiculo_evento` con el `autor_id` real, así que el uso es
  rastreable después del hecho, pero **no hay aprobación previa ni alerta en el momento**.
- Otorgar `es_sau_admin` o `es_sau_contadora` a alguien equivale a darle esa llave sobre toda la
  base de clientes. Conviene revisar periódicamente quién las tiene.

Si en algún momento se quiere cerrar, el cambio es acotado: sacar la rama de `es_contadora_o_admin()`
en la función y darle al personal de soporte una membresía explícita en cada empresa que atienda.

### Los cobros solo se registran por función (migración 0028)

Un trigger sobre `vehiculo_monto` rechaza cualquier cambio directo a `cobro_compania`,
`cobro_franquicia` o `cobro_particular`. Solo `taller_registrar_cobro` puede tocarlos, lo que
garantiza que **nunca quede un monto dado por cobrado sin su movimiento en la bitácora**. Los montos
en sí (`monto_*`) se siguen editando normalmente por API, con permiso `taller.montos`.

### Triggers y funciones propias

| Objeto | Qué hace |
|---|---|
| `normalizar_patente()` + `trg_normalizar_patente` | Pasa la patente a mayúsculas y le saca todo lo que no sea alfanumérico, en la base y no en el formulario |
| `taller_marcar_trabajo_hecho()` | Marcado de trabajo por el operario, con chequeo de permiso |
| `tiene_permiso_taller()` | Evaluación de permisos del taller |
| `tiene_permiso()` | Versión previa, usada por otros módulos |
| `empresas_del_usuario()`, `es_contadora_o_admin()` | Auxiliares del patrón general |
| `fn_actualizar_stock()` + `trg_actualizar_stock` | Stock |
| `actualizar_saldo_fiado()` + `trg_saldo_fiado` | Fiado |

Además, un índice único parcial impide cargar dos veces la misma patente **mientras el vehículo
está adentro**, permitiendo que el mismo auto vuelva meses después:

```sql
create unique index idx_vehiculo_patente_activa
  on vehiculo (empresa_id, patente) where etapa <> 'entregado';
```

---

## 8. Storage

Dos buckets:

| Bucket | Público | Uso |
|---|---|---|
| `consultas` | **Sí** | Audios de leads que llegan por la landing |
| `taller` | No | Fotos de recepción y órdenes de trabajo en PDF |

Policies sobre `storage.objects`:

| Policy | Operación | Condición |
|---|---|---|
| `taller_archivos_leer` | SELECT | `bucket_id = 'taller'` y usuario autenticado |
| `taller_archivos_subir` | INSERT | `bucket_id = 'taller'` y usuario autenticado |
| `lecturas publicas consultas` | SELECT | bucket `consultas` |
| `uploads publicos consultas` | INSERT | bucket `consultas` |

Los archivos se guardan con la ruta `{empresa_id}/{vehiculo_id}/{tipo}-{timestamp}-{random}.{ext}`
y se leen con URLs firmadas a una hora (`createSignedUrl`).

Desde la migración `0026`, ambas policies comprueban que **el primer segmento de la ruta sea una
empresa del usuario** y que tenga el permiso correspondiente (`taller.ver` para leer,
`taller.cargar` para subir). Antes alcanzaba con estar autenticado, y alguien de otra empresa que
conociera una ruta podía pedir la URL firmada. Verificado con usuarios de dos empresas distintas.

No hay policies de UPDATE ni DELETE, así que nadie puede modificar ni borrar archivos.

---

## 9. Estado de cada pantalla

### Módulo taller

| Pantalla | Archivo | Estado |
|---|---|---|
| Tablero | `src/pages/Taller.jsx` | **Funcional.** KPIs, agrupación por etapa, alertas, buscador |
| Alta de vehículo | `src/pages/TallerNuevo.jsx` | **Funcional, salvo la subida de archivos** (ver abajo) |
| Ficha del vehículo | `src/pages/TallerVehiculo.jsx` | **Funcional.** Etapas, validación, excepciones, cobros, entrega, bitácora |
| Consulta histórica de entregados | — | **No existe.** Es el pendiente principal |
| Dashboard separado | — | **No existe.** Los indicadores están arriba del tablero |

### Resto de SAU (preexistente)

Ventas, Caja, Historial, Compras, Equipo, Stock, Fiado, Presupuestos, Contadora, Perfil, Importar,
paneles de admin, y las pantallas públicas sin login (`/pedir/:empresaId`, `/reservar/:empresaId`,
`/r/:id`, `/quejate`, `/unirse`). Todas preexistentes a esta revisión y fuera del alcance del
trabajo reciente.

### Flujo de etapas del taller

Cadena secuencial obligatoria de 7 etapas:

```
recepcion → chapa → preparacion → pintura → pre_entrega → terminado → entregado
```

Con **doble confirmación**: el operario marca `trabajo_hecho = true`, lo que **no mueve el
vehículo**; recién un rol con `taller.validar` lo avanza. Al avanzar se reinicia `etapa_desde`, que
es lo que alimenta la alerta de estancamiento.

Tres **estados de excepción** (`mecanica`, `detenido`, `ampliacion`) guardados en una columna
aparte: son una etiqueta encima de la etapa y no la reemplazan, así no se pierde dónde estaba el
auto. En la planilla Excel que este módulo reemplaza, esa información se perdía.

Alertas calculadas en el cliente (`src/lib/taller.js`): más de 20 días en taller, más de 7 días sin
avanzar de etapa, y fecha pactada vencida o a 2 días o menos.

---

## 10. Qué es funcional, qué está simulado y qué está bloqueado

### Funcional y verificado

- Todo el flujo de etapas del taller, con sus permisos aplicados en la base.
- Normalización de patente y el índice único, verificados contra el esquema vivo.
- El resto de los módulos de SAU, en uso real por clientes.

### Datos de demostración, no de producción

La empresa **TALLER FORANI** tiene **12 vehículos cargados por script**, tomados de la planilla real
del cliente para que el tablero no se vea vacío en una demo. **No son datos ingresados por el
cliente ni hay que tratarlos como producción.** Incluyen montos, fechas y observaciones reales de su
Excel.

### Suite de pruebas

Hay **55 pruebas automatizadas** que corren con usuarios reales de **dos empresas distintas** y los
cuatro roles, autenticándose de verdad contra la API pública. Prueban las policies y las funciones,
no la interfaz:

```bash
supabase db query --linked -f scripts/seed-pruebas-taller.sql   # reinicia el banco de pruebas
node scripts/pruebas-taller.mjs                                 # 55 pasan, 0 fallan
```

**El seed hay que correrlo antes de cada ejecución**: la suite lleva el vehículo hasta entregado, y
sin reiniciarlo la corrida siguiente arranca de un estado terminal. El seed hace ese reinicio y
**no toca los datos demo**: trabaja sobre dos empresas `ZZ PRUEBA` creadas aparte.

Cubren aislamiento entre empresas, montos, flujo de etapas, excepciones, bitácora, storage, entrega,
etapas habilitadas por operario, doble marcado y registro de cobros.

### Sin probar

- **Subida de fotos y PDFs desde la interfaz.** La suite sube y firma archivos por API
  correctamente, pero el formulario de `TallerNuevo.jsx` con la cámara del celular nunca se ejecutó
  de punta a punta. `vehiculo_archivo` sigue en 0 filas.
- **`whatsapp-webhook`** está deployada y fue probada con un payload simulado de Meta que recorrió
  toda la cadena correctamente, pero **nunca recibió un mensaje real de WhatsApp**: el número del
  cliente todavía no está conectado.

### Bloqueado

**Nada está bloqueado en este momento.** El proyecto Supabase está activo.

Sí hay un riesgo operativo que conviene conocer: el proyecto está en **plan gratuito y se pausa solo
por inactividad**. Pasó **tres veces** en las últimas semanas, y mientras está pausado ni siquiera
resuelve el DNS, con lo cual la aplicación entera deja de responder. Restaurarlo es manual, desde el
panel de Supabase. Para un cliente que espere disponibilidad, esto hay que resolverlo con el plan
Pro o con una tarea periódica que mantenga la base despierta.

### Observación sobre la configuración de TALLER FORANI

La empresa quedó con `modulos_activos = ['taller']` únicamente. En `src/lib/modulos.js` el módulo
`ventas` está declarado con `nucleo: true`, es decir que no debería poder desactivarse. Vale
confirmar si esa combinación rompe alguna pantalla de inicio.

---

## 11. Archivos para revisar

### Configuración

- `package.json`, `package-lock.json`
- `.env.example` — nombres de variables, sin valores
- `vite.config.js`, `eslint.config.js`, `vercel.json`

### Base de datos

- `supabase/migrations/0025_taller.sql` — **el más importante**: tablas, RLS, funciones, trigger,
  índice único y policies de storage del módulo nuevo
- `supabase/migrations/0010_modulos.sql`, `0014_sau_admin.sql`, `0017_agente.sql`, `0023_caso.sql`
- El resto de `supabase/migrations/`, en orden numérico

### Autenticación y roles

- `src/context/AuthContext.jsx` — sesión, membresías, `tienePermiso`, `tieneModulo`
- `src/AppRouter.jsx` — guardas `Protegido`, `ProtegidoAdmin`, `ProtegidoContadora`
- `src/components/Layout.jsx` — filtrado de pestañas por módulo y permiso
- `src/lib/constants.js` — catálogo de permisos
- `src/lib/modulos.js` — catálogo de módulos
- `src/pages/EquipoTareas.jsx` — traducción de permisos a lenguaje de negocio, perfiles rápidos

### Código que muestra, calcula o edita montos

- `src/lib/taller.js` — `pendiente()`, `total()`, `fmtMonto()`
- `src/pages/Taller.jsx` — lectura de `vehiculo_monto` y total pendiente del tablero
- `src/pages/TallerNuevo.jsx` — alta de montos, condicionada a `taller.montos`
- `src/pages/TallerVehiculo.jsx` — validaciones de cobro y cálculo de pendiente
- `supabase/migrations/0025_taller.sql` — policies de `vehiculo_monto`

### Alta, etapas, reporte diario, paños y entrega

- `src/lib/taller.js` — catálogo de etapas, excepciones, umbrales de alerta, `etapaSiguiente()`
- `src/pages/TallerNuevo.jsx` — alta completa, incluido el campo **paños**
- `src/pages/TallerVehiculo.jsx` — `marcarHecho()`, `validarYAvanzar()`, `toggleExcepcion()`,
  `toggleCobro()`, `entregar()`, `agregarNota()`
- `supabase/migrations/0025_taller.sql` — `taller_marcar_trabajo_hecho()` y el check de etapas

### Agente IA y WhatsApp

- `supabase/functions/chat-agente/index.ts`
- `supabase/functions/whatsapp-webhook/index.ts`

---

## 12. Pendientes, por prioridad

| # | Pendiente | Por qué |
|---|---|---|
| 1 | **Probar la subida de fotos desde el celular** | Por API funciona; el formulario con la cámara nunca se ejecutó |
| 2 | **Consulta histórica de entregados** | Requisito explícito del cliente, no existe |
| 3 | **Evitar la pausa de Supabase** | Plan Pro o tarea de keep-alive |
| 4 | Definir campos obligatorios con el cliente | El documento funcional pide kilometraje y perito obligatorios, pero su planilla real no tiene kilometraje y el perito se carga al entregar |
| 5 | Decidir la identidad visual | El prototipo del cliente es claro con azul y dorado; SAU es oscuro con verde |
| 6 | Conectar el número de WhatsApp del cliente del agente | Trabado en verificación de negocio en Meta |
| 7 | Dividir el bundle | 1,25 MB en un solo chunk |
| 8 | Renombrar el proyecto en `package.json` | Sigue diciendo `kiosco-carlitos` |
| 9 | Tests del resto de SAU | El taller tiene 41; los demás módulos ninguno |

**Resueltos desde la primera versión de este documento:** las policies de storage ya verifican
pertenencia a la empresa (§8), el flujo ya no se puede saltear con `UPDATE` directo (§7), y la
asignación por especialidad cerró el hueco de que un operario marcara trabajo de otro oficio.

---

## 13. Qué **no** contiene este documento

Ni claves, ni contraseñas, ni tokens, ni `service_role_key`, ni el contenido de `.env.local`, ni
datos personales de clientes. Las credenciales viven en `.env.local` (no versionado) y en las
variables de entorno de Vercel y Supabase.
