-- Estructura capturada de producción el 29/09/2026 — SOLO REFERENCIA
--
-- Este archivo NO es una migración y está a propósito fuera de
-- supabase/migrations/ para que no se ejecute solo. Es el borrador de lo que
-- iría en 0033_esquema_faltante.sql si se aprueba la propuesta de
-- docs/auditoria-migraciones.md, sección D.
--
-- Contiene solo estructura: ninguna fila, ningún dato de cliente.
--
-- Sin revisar todavía:
--   * leads_nico.id es bigint sin default en information_schema; casi seguro es
--     una identity, pero hay que confirmarlo antes de escribir la migración.
--   * Faltan los índices: no los capturé.

-- ── Presupuestos ────────────────────────────────────────────────────

create table if not exists presupuesto (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresa(id) on delete cascade,
  numero         integer not null default 1,
  cliente_nombre text not null,
  cliente_tel    text,
  descripcion    text,
  estado         text not null default 'pendiente',
  descuento      numeric not null default 0,
  total          numeric not null default 0,
  notas          text,
  created_at     timestamptz default now(),
  aprobado       boolean not null default false,
  creado_por     uuid,
  titulo         text,
  incluye        text,
  condiciones    text,
  precio_base    numeric,
  enviado        boolean not null default false,
  tiene_cambios  boolean not null default false
);

create table if not exists presupuesto_item (
  id              uuid primary key default gen_random_uuid(),
  presupuesto_id  uuid not null references presupuesto(id) on delete cascade,
  descripcion     text not null,
  unidad          text not null default 'unidad',
  cantidad        numeric not null default 1,
  precio_unitario numeric not null default 0,
  orden           integer not null default 0
);

create table if not exists plantilla_presupuesto (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  nombre      text not null,
  titulo      text not null,
  descripcion text,
  incluye     text,
  condiciones text,
  precio      numeric not null default 0,
  activo      boolean not null default true,
  orden       integer not null default 0,
  created_at  timestamptz default now()
);

create table if not exists catalogo_item (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresa(id) on delete cascade,
  nombre     text not null,
  unidad     text not null default 'unidad',
  precio     numeric not null default 0,
  categoria  text not null default 'material',
  activo     boolean not null default true,
  created_at timestamptz default now()
);

-- ── Pedidos ─────────────────────────────────────────────────────────
-- Ojo: pedido_insert_publico permite insertar a cualquiera, incluido anon.
-- Es a propósito (formulario público), pero conviene mirarlo de nuevo.

create table if not exists pedido (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresa(id) on delete cascade,
  nombre_cliente text not null,
  telefono       text,
  descripcion    text not null,
  estado         text not null default 'nuevo',
  presupuesto_id uuid references presupuesto(id) on delete set null,
  created_at     timestamptz default now()
);

-- ── Panel de la contadora ───────────────────────────────────────────

create table if not exists tarea_contadora (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresa(id) on delete cascade,
  titulo      text not null,
  descripcion text,
  tipo        text default 'documentacion',
  estado      text default 'pendiente',
  notas       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── Leads ───────────────────────────────────────────────────────────
-- Tiene RLS activo y CERO policies: hoy solo la lee service_role.

create table if not exists leads_nico (
  id                 bigint primary key,
  created_at         timestamptz default now(),
  telefono_whatsapp  text,
  accion             text,
  score              integer,
  motivo             text,
  nombre             text,
  telefono           text,
  email              text,
  rubro              text,
  situacion_fiscal   text,
  como_lleva_numeros text,
  dolor_principal    text,
  empleados          text,
  urgencia           text,
  observaciones      text,
  mensaje_final      text
);

-- ── RLS y policies, tal cual están en producción ────────────────────

alter table presupuesto           enable row level security;
alter table presupuesto_item      enable row level security;
alter table plantilla_presupuesto enable row level security;
alter table catalogo_item         enable row level security;
alter table pedido                enable row level security;
alter table tarea_contadora       enable row level security;
alter table leads_nico            enable row level security;

drop policy if exists miembros_presupuesto on presupuesto;
create policy miembros_presupuesto on presupuesto for all
  using (empresa_id in (
    select empresa_id from membresia where usuario_id = auth.uid() and activa = true));

drop policy if exists miembros_pres_item on presupuesto_item;
create policy miembros_pres_item on presupuesto_item for all
  using (presupuesto_id in (
    select id from presupuesto where empresa_id in (
      select empresa_id from membresia where usuario_id = auth.uid() and activa = true)));

drop policy if exists plantilla_miembros on plantilla_presupuesto;
create policy plantilla_miembros on plantilla_presupuesto for all
  using (empresa_id in (
    select empresa_id from membresia where usuario_id = auth.uid() and activa = true));

drop policy if exists miembros_catalogo on catalogo_item;
create policy miembros_catalogo on catalogo_item for all
  using (empresa_id in (
    select empresa_id from membresia where usuario_id = auth.uid() and activa = true));

drop policy if exists pedido_miembros on pedido;
create policy pedido_miembros on pedido for all
  using (empresa_id in (
    select empresa_id from membresia where usuario_id = auth.uid() and activa = true));

drop policy if exists pedido_insert_publico on pedido;
create policy pedido_insert_publico on pedido for insert with check (true);

drop policy if exists contadora_acceso on tarea_contadora;
create policy contadora_acceso on tarea_contadora for all
  using (exists (
    select 1 from profile
     where profile.id = auth.uid()
       and (profile.es_sau_contadora = true or profile.es_sau_admin = true)));

-- ── Fiado: la versión que de verdad corre en producción ─────────────
-- La migración 0013 dejó fn_actualizar_saldo_fiado + trg_actualizar_saldo_fiado,
-- que solo reaccionan al insert y usan NEW. Producción corre esta otra, que
-- también recalcula al editar y al borrar.

create or replace function actualizar_saldo_fiado()
returns trigger language plpgsql as $$
declare cid uuid;
begin
  cid := coalesce(NEW.cliente_fiado_id, OLD.cliente_fiado_id);
  update cliente_fiado set saldo_actual = (
    select coalesce(sum(case when tipo = 'fiado' then monto else -monto end), 0)
      from movimiento_fiado where cliente_fiado_id = cid
  ) where id = cid;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_actualizar_saldo_fiado on movimiento_fiado;
drop trigger if exists trg_saldo_fiado on movimiento_fiado;
create trigger trg_saldo_fiado
  after insert or update or delete on movimiento_fiado
  for each row execute function actualizar_saldo_fiado();

drop function if exists fn_actualizar_saldo_fiado();

-- ── Bucket de consultas ─────────────────────────────────────────────
-- Es público a propósito: los audios de consulta se comparten por link.

insert into storage.buckets (id, name, public)
values ('consultas', 'consultas', true)
on conflict (id) do nothing;

drop policy if exists "lecturas publicas consultas" on storage.objects;
create policy "lecturas publicas consultas" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'consultas');

-- Esta deja subir a `anon`: con la anon key, cualquiera puede escribir en un
-- bucket público. Se copia tal cual está para no cambiar el comportamiento,
-- pero está anotada en la auditoría como algo a revisar aparte.
drop policy if exists "uploads publicos consultas" on storage.objects;
create policy "uploads publicos consultas" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'consultas');

-- ── Limpieza ────────────────────────────────────────────────────────
-- Su trigger lo borró 0026; la función quedó dando vueltas.

drop function if exists taller_crear_monto();
