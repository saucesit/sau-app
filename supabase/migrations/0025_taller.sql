-- Módulo Taller: seguimiento de vehículos en un taller de chapa y pintura.
-- Reemplaza la planilla Excel donde hoy se sigue a mano cada auto.
--
-- Tres decisiones que no se ven en los nombres de las tablas:
--
--   1. La cadena de etapas es secuencial y validada: el operario marca su trabajo
--      como hecho, pero el vehículo NO avanza hasta que otro rol lo valida.
--   2. Los estados de excepción (mecánica, detenido, ampliación) son una etiqueta
--      encima de la etapa, no la reemplazan. En el Excel se perdía la etapa de origen.
--   3. Los montos viven en OTRA tabla a propósito. Postgres no sabe ocultar columnas
--      sueltas por permiso, así que la única forma de que un operario realmente no
--      pueda leer los precios —ni desde la API— es que estén en una tabla aparte
--      con su propia policy. Ocultarlos en la interfaz no es suficiente.

-- ── Permisos: misma semántica que tienePermiso() en el front ──────
-- contadora y admin pueden todo; el resto depende del array de permisos.
create or replace function tiene_permiso_taller(p_empresa uuid, p_permiso text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select es_contadora_o_admin() or exists (
    select 1 from membresia m
    where m.usuario_id = auth.uid()
      and m.empresa_id = p_empresa
      and m.activa = true
      and (m.rol in ('contadora','admin') or p_permiso = any(m.permisos))
  );
$$;

-- ── Vehículo ──────────────────────────────────────────────────────
create table if not exists vehiculo (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresa(id) on delete cascade,

  patente          text not null,
  vehiculo         text not null,          -- marca y modelo
  kilometraje      int,
  cliente_nombre   text not null,
  panos            int,                    -- paños a trabajar (unidad de medida del rubro)

  compania         text not null,
  productor        text,
  perito           text,
  nro_siniestro    text,

  fecha_ingreso    date not null default current_date,
  fecha_pactada    date,
  fecha_entrega    date,

  etapa            text not null default 'recepcion'
                   check (etapa in ('recepcion','chapa','preparacion','pintura','pre_entrega','terminado','entregado')),
  etapa_desde      timestamptz not null default now(),   -- para calcular días sin avanzar
  trabajo_hecho    boolean not null default false,       -- el operario terminó, espera validación
  excepcion        text check (excepcion is null or excepcion in ('mecanica','detenido','ampliacion')),
  excepcion_desde  timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- La patente se normaliza en la base y no en el formulario: así no entra dos veces
-- el mismo auto por un espacio o un guion de diferencia (en su Excel conviven
-- "AF937ER" y "AF 937 ER").
create or replace function normalizar_patente()
returns trigger language plpgsql as $$
begin
  new.patente := upper(regexp_replace(coalesce(new.patente,''), '[^A-Za-z0-9]', '', 'g'));
  return new;
end;
$$;

drop trigger if exists trg_normalizar_patente on vehiculo;
create trigger trg_normalizar_patente
  before insert or update of patente on vehiculo
  for each row execute function normalizar_patente();

-- Un mismo auto puede volver al taller meses después, así que la patente solo
-- es única entre los que están adentro ahora.
create unique index if not exists idx_vehiculo_patente_activa
  on vehiculo (empresa_id, patente) where etapa <> 'entregado';

create index if not exists idx_vehiculo_empresa_etapa on vehiculo (empresa_id, etapa);

-- ── Montos (tabla aparte: ver decisión 3 arriba) ──────────────────
create table if not exists vehiculo_monto (
  vehiculo_id      uuid primary key references vehiculo(id) on delete cascade,
  empresa_id       uuid not null references empresa(id) on delete cascade,
  monto_compania   numeric not null default 0,
  monto_franquicia numeric not null default 0,
  monto_particular numeric not null default 0,
  -- Validaciones de cobro, independientes entre sí
  cobro_compania   boolean not null default false,
  cobro_franquicia boolean not null default false,
  cobro_particular boolean not null default false,
  updated_at       timestamptz not null default now()
);

create index if not exists idx_vehiculo_monto_empresa on vehiculo_monto (empresa_id);

-- ── Bitácora: el "reporte diario y observaciones" de la planilla ──
create table if not exists vehiculo_evento (
  id           uuid primary key default gen_random_uuid(),
  vehiculo_id  uuid not null references vehiculo(id) on delete cascade,
  tipo         text not null
               check (tipo in ('ingreso','nota','trabajo_hecho','avance','excepcion','cobro','entrega')),
  etapa        text,
  texto        text,
  autor_id     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_vehiculo_evento on vehiculo_evento (vehiculo_id, created_at desc);

-- ── Fotos de ingreso/proceso/entrega y órdenes de trabajo ─────────
create table if not exists vehiculo_archivo (
  id           uuid primary key default gen_random_uuid(),
  vehiculo_id  uuid not null references vehiculo(id) on delete cascade,
  tipo         text not null
               check (tipo in ('foto_ingreso','foto_proceso','foto_entrega','orden_interna','orden_compania')),
  path         text not null,
  nombre       text,
  autor_id     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_vehiculo_archivo on vehiculo_archivo (vehiculo_id, tipo);

-- ── Avance de etapa: solo quien valida ────────────────────────────
-- El operario nunca mueve el vehículo. Marca lo suyo con la función de abajo.
create or replace function taller_marcar_trabajo_hecho(p_vehiculo uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_empresa uuid;
  v_etapa   text;
begin
  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo;
  if v_empresa is null then
    raise exception 'El vehículo no existe';
  end if;
  if not tiene_permiso_taller(v_empresa, 'taller.trabajar') then
    raise exception 'No tenés permiso para marcar trabajo realizado';
  end if;

  update vehiculo set trabajo_hecho = true, updated_at = now() where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto, autor_id)
  values (p_vehiculo, 'trabajo_hecho', v_etapa, 'Trabajo marcado como realizado', auth.uid());
end;
$$;

grant execute on function taller_marcar_trabajo_hecho(uuid) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────
alter table vehiculo          enable row level security;
alter table vehiculo_monto    enable row level security;
alter table vehiculo_evento   enable row level security;
alter table vehiculo_archivo  enable row level security;

-- Vehículo: lo ve cualquiera del taller; lo crea quien carga; lo modifica quien
-- valida; lo borra solo un administrador de la empresa (el "rol completo").
create policy vehiculo_select on vehiculo
  for select using (tiene_permiso_taller(empresa_id, 'taller.ver'));
create policy vehiculo_insert on vehiculo
  for insert with check (tiene_permiso_taller(empresa_id, 'taller.cargar'));
create policy vehiculo_update on vehiculo
  for update using (tiene_permiso_taller(empresa_id, 'taller.validar'))
  with check (tiene_permiso_taller(empresa_id, 'taller.validar'));
create policy vehiculo_delete on vehiculo
  for delete using (tiene_permiso_taller(empresa_id, 'empresa.admin'));

-- Montos: nadie sin taller.montos los lee, ni siquiera por API.
create policy vehiculo_monto_select on vehiculo_monto
  for select using (tiene_permiso_taller(empresa_id, 'taller.montos'));
create policy vehiculo_monto_write on vehiculo_monto
  for all using (tiene_permiso_taller(empresa_id, 'taller.montos'))
  with check (tiene_permiso_taller(empresa_id, 'taller.montos'));

-- Bitácora: la lee y escribe cualquiera del taller (el operario suma observaciones).
create policy vehiculo_evento_select on vehiculo_evento
  for select using (
    vehiculo_id in (select id from vehiculo where tiene_permiso_taller(empresa_id, 'taller.ver'))
  );
create policy vehiculo_evento_insert on vehiculo_evento
  for insert with check (
    vehiculo_id in (select id from vehiculo where tiene_permiso_taller(empresa_id, 'taller.ver'))
  );

create policy vehiculo_archivo_select on vehiculo_archivo
  for select using (
    vehiculo_id in (select id from vehiculo where tiene_permiso_taller(empresa_id, 'taller.ver'))
  );
create policy vehiculo_archivo_insert on vehiculo_archivo
  for insert with check (
    vehiculo_id in (select id from vehiculo where tiene_permiso_taller(empresa_id, 'taller.cargar'))
  );

-- ── Storage para fotos y órdenes de trabajo ───────────────────────
insert into storage.buckets (id, name, public)
values ('taller', 'taller', false)
on conflict (id) do nothing;

drop policy if exists taller_archivos_leer on storage.objects;
create policy taller_archivos_leer on storage.objects
  for select using (bucket_id = 'taller' and auth.role() = 'authenticated');

drop policy if exists taller_archivos_subir on storage.objects;
create policy taller_archivos_subir on storage.objects
  for insert with check (bucket_id = 'taller' and auth.role() = 'authenticated');
