-- Capa de lectura para integraciones externas.
--
-- Tefo está armando un agente en n8n que le manda un reporte diario del taller.
-- Necesita leer; no necesita —ni debe poder— escribir nada.
--
-- Lo que NO se hizo, y por qué:
--   * No se le da una cuenta de usuario. Con un JWT de usuario, PostgREST le
--     deja enumerar cualquier tabla del esquema y llamar cualquier RPC: filtra
--     RLS, pero la superficie es enorme y la credencial serviría para entrar a
--     SAU. Acá no hay sesión: no hay auth.uid(), así que TODAS las policies del
--     taller lo rechazan por construcción.
--   * No se reutiliza ninguna RPC operativa del taller. Las de acá son nuevas,
--     de solo lectura, y no tienen permiso de ejecución para `authenticated`:
--     solo las puede llamar la Edge Function con service_role.
--   * El contrato que sale no copia los nombres internos. Si mañana se agrega
--     una columna a `vehiculo`, no aparece sola en la respuesta: cada campo se
--     nombra a mano. Eso además evita regalar la estructura de la base, que
--     hoy no se puede listar desde afuera.
--
-- El aislamiento por empresa es el punto central: el empresa_id sale SIEMPRE de
-- la fila de la credencial, nunca del pedido. No hay forma de expresarlo desde
-- afuera porque ninguna función de acá lo recibe del consumidor.

-- ── 1. Las credenciales ───────────────────────────────────────────
-- RLS activada y CERO policies, igual que agente_credenciales: solo
-- service_role la toca. Nunca llega al navegador.

create table if not exists integracion_api_key (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresa(id) on delete cascade,
  nombre        text not null,
  -- Los primeros caracteres, para poder decir "la clave sauk_7f3a hizo esta
  -- consulta" sin guardar ni mostrar la clave.
  prefijo       text not null,
  -- Solo el hash. La clave en claro se muestra una vez y no se guarda nunca.
  clave_hash    text not null unique,
  alcances      text[] not null default '{}',
  activa        boolean not null default true,
  creada_en     timestamptz not null default now(),
  expira_en     timestamptz not null default now() + interval '180 days',
  ultimo_acceso timestamptz,
  ultima_ip     text
);

comment on table integracion_api_key is
  'Credenciales de integraciones externas de solo lectura. No son usuarios: no abren sesión en SAU. El empresa_id de esta fila es el único alcance posible de la clave.';

alter table integracion_api_key enable row level security;

create index if not exists idx_integracion_api_key_empresa
  on integracion_api_key(empresa_id);

-- ── 2. El registro de accesos ─────────────────────────────────────
-- Lo mínimo para saber quién consultó qué y cuándo. NO se guarda el payload:
-- loggear las respuestas sería crear una segunda copia de lo que se protege.

create table if not exists integracion_log (
  id         bigserial primary key,
  api_key_id uuid references integracion_api_key(id) on delete set null,
  prefijo    text,
  recurso    text,
  filas      integer,
  status     integer,
  ip         text,
  creado_en  timestamptz not null default now()
);

comment on table integracion_log is
  'Accesos de las integraciones. Sin payloads ni respuestas: solo quién, qué recurso, cuántas filas y con qué estado.';

alter table integracion_log enable row level security;

create index if not exists idx_integracion_log_fecha
  on integracion_log(creado_en desc);

-- ── 3. Crear una credencial ───────────────────────────────────────
-- Devuelve la clave en claro UNA vez. No queda guardada en ningún lado: lo que
-- se persiste es el sha256. Si se pierde, se emite otra; no hay forma de
-- recuperarla, y eso es a propósito.

create or replace function integracion_crear_clave(
  p_empresa  uuid,
  p_nombre   text,
  p_alcances text[] default array['resumen','vehiculos','movimientos','facturacion','adjuntos'],
  p_dias     integer default 180
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clave   text;
  v_prefijo text;
  v_id      uuid;
begin
  if not exists (select 1 from empresa where id = p_empresa) then
    raise exception 'La empresa no existe';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'La integración necesita un nombre';
  end if;

  -- 32 bytes de aleatoriedad criptográfica.
  v_clave   := 'sauk_' || encode(gen_random_bytes(32), 'hex');
  v_prefijo := left(v_clave, 14);

  insert into integracion_api_key (empresa_id, nombre, prefijo, clave_hash, alcances, expira_en)
  values (p_empresa, trim(p_nombre), v_prefijo,
          encode(digest(v_clave, 'sha256'), 'hex'),
          p_alcances, now() + make_interval(days => p_dias))
  returning id into v_id;

  return json_build_object(
    'id', v_id, 'nombre', trim(p_nombre), 'prefijo', v_prefijo,
    'clave', v_clave,
    'aviso', 'Esta clave se muestra una sola vez. Guardala ahora.');
end;
$$;

-- ── 4. Validar una credencial ─────────────────────────────────────
-- Devuelve el alcance de la clave, o null. Acá nace el empresa_id de toda la
-- integración: no se recibe de afuera, se resuelve de la fila.

create or replace function integracion_validar_clave(p_clave text, p_ip text default null)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  k record;
begin
  if coalesce(p_clave, '') = '' then return null; end if;

  select * into k from integracion_api_key
   where clave_hash = encode(digest(p_clave, 'sha256'), 'hex');

  if not found then return null; end if;
  if not k.activa then return null; end if;
  if k.expira_en < now() then return null; end if;

  update integracion_api_key
     set ultimo_acceso = now(), ultima_ip = coalesce(p_ip, ultima_ip)
   where id = k.id;

  return json_build_object(
    'id', k.id, 'empresa_id', k.empresa_id,
    'nombre', k.nombre, 'prefijo', k.prefijo, 'alcances', k.alcances);
end;
$$;

-- ── 5. Los cinco recursos ─────────────────────────────────────────
-- Todos reciben el empresa_id YA RESUELTO por la validación de la clave.
-- Todos son SELECT. Ninguno escribe. Cada campo del contrato está nombrado a
-- mano: agregar una columna a una tabla no la hace aparecer acá.

create or replace function integracion_resumen(p_empresa uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'activos',   count(*) filter (where etapa <> 'entregado'),
    'entregados_total', count(*) filter (where etapa = 'entregado'),
    'entregados_ultimos_30_dias',
       count(*) filter (where etapa = 'entregado' and fecha_entrega > current_date - 30),
    'por_etapa', (select json_object_agg(e, n) from
       (select etapa e, count(*) n from vehiculo
         where empresa_id = p_empresa and etapa <> 'entregado' group by 1) x),
    'fuera_de_plazo', count(*) filter (
       where etapa <> 'entregado' and fecha_pactada is not null and fecha_pactada < current_date),
    'sin_fecha_pactada', count(*) filter (
       where etapa <> 'entregado' and fecha_pactada is null),
    'con_excepcion', (select coalesce(json_object_agg(ex, n), '{}'::json) from
       (select excepcion ex, count(*) n from vehiculo
         where empresa_id = p_empresa and etapa <> 'entregado' and excepcion is not null
         group by 1) y))
  from vehiculo where empresa_id = p_empresa
$$;

create or replace function integracion_vehiculos(
  p_empresa uuid, p_estado text default 'activos',
  p_limite integer default 200, p_desde integer default 0)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(d order by d->>'ingreso'), '[]'::json) from (
    select json_build_object(
      'patente',        patente,
      'vehiculo',       vehiculo,
      'cliente',        cliente_nombre,
      'compania',       compania,
      'siniestro',      nro_siniestro,
      'etapa',          etapa,
      'en_etapa_desde', etapa_desde,
      'ingreso',        fecha_ingreso,
      'pactada',        fecha_pactada,
      'entrega',        fecha_entrega,
      'dias_en_taller', coalesce(fecha_entrega, current_date) - fecha_ingreso,
      'fuera_de_plazo', fecha_pactada is not null and fecha_pactada < current_date
                        and etapa <> 'entregado',
      'excepcion',      excepcion,
      'excepcion_desde', excepcion_desde,
      'panos',          panos,
      'trabajo_marcado', trabajo_hecho
    ) as d
    from vehiculo
    where empresa_id = p_empresa
      and (p_estado = 'todos'
        or (p_estado = 'activos'    and etapa <> 'entregado')
        or (p_estado = 'entregados' and etapa =  'entregado'))
    order by fecha_ingreso desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_desde, 0), 0)
  ) t
$$;

-- La etapa anterior no existe como columna: vive adentro del texto del
-- movimiento. Se deriva de la cadena, que es más robusto que parsear: el
-- avance siempre es un paso adelante y el retroceso uno atrás.
create or replace function integracion_movimientos(
  p_empresa uuid, p_desde date default null, p_hasta date default null,
  p_limite integer default 200, p_salto integer default 0)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with rango as (
    select coalesce(p_hasta, current_date) as hasta,
           greatest(coalesce(p_desde, current_date - 30),
                    coalesce(p_hasta, current_date) - 90) as desde
  ),
  etapas as (select taller_etapas() as e)
  select coalesce(json_agg(d order by d->>'fecha' desc), '[]'::json) from (
    select json_build_object(
      'fecha',   ev.created_at,
      'patente', v.patente,
      'tipo',    ev.tipo,
      'etapa_anterior', case
        when ev.tipo = 'avance'     then (select e[array_position(e, ev.etapa) - 1] from etapas)
        when ev.tipo = 'retroceso'  then (select e[array_position(e, ev.etapa) + 1] from etapas)
        when ev.tipo = 'entrega'    then 'control_calidad'
        when ev.tipo = 'reapertura' then 'entregado'
        else null end,
      'etapa_nueva', case
        when ev.tipo in ('avance','retroceso','entrega','reapertura') then ev.etapa
        else null end,
      'etapa',   ev.etapa,
      'usuario', nullif(trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')), ''),
      'detalle', ev.texto
    ) as d
    from vehiculo_evento ev
    join vehiculo v on v.id = ev.vehiculo_id
    left join profile p on p.id = ev.autor_id,
    rango r
    where v.empresa_id = p_empresa
      and ev.created_at >= r.desde
      and ev.created_at < r.hasta + 1
    order by ev.created_at desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_salto, 0), 0)
  ) t
$$;

-- Variante B: importe, rubro, estado de facturación y de cobro.
-- SIN número de factura, que es el dato más sensible y no aporta a un reporte.
create or replace function integracion_facturacion(
  p_empresa uuid, p_estado text default 'activos',
  p_limite integer default 200, p_salto integer default 0)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(d), '[]'::json) from (
    select json_build_object(
      'patente', v.patente,
      'etapa',   v.etapa,
      'importes', json_build_object(
        'compania',   json_build_object('monto', m.monto_compania,
                        'estado', coalesce(m.estado_compania,'pendiente'), 'cobrado', m.cobro_compania),
        'franquicia', json_build_object('monto', m.monto_franquicia,
                        'estado', coalesce(m.estado_franquicia,'pendiente'), 'cobrado', m.cobro_franquicia),
        'particular', json_build_object('monto', m.monto_particular,
                        'estado', coalesce(m.estado_particular,'pendiente'), 'cobrado', m.cobro_particular))
    ) as d
    from vehiculo_monto m
    join vehiculo v on v.id = m.vehiculo_id
    where v.empresa_id = p_empresa
      and (p_estado = 'todos'
        or (p_estado = 'activos'    and v.etapa <> 'entregado')
        or (p_estado = 'entregados' and v.etapa =  'entregado'))
    order by v.fecha_ingreso desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_salto, 0), 0)
  ) t
$$;

-- Metadata y nada más. Sin `path`, sin URL, sin firma: no hay forma de bajar
-- un archivo por esta vía, ni siquiera conociendo el nombre.
create or replace function integracion_adjuntos(
  p_empresa uuid, p_patente text default null,
  p_limite integer default 200, p_salto integer default 0)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(d order by d->>'fecha' desc), '[]'::json) from (
    select json_build_object(
      'patente', v.patente,
      'tipo',    a.tipo,
      'nombre',  a.nombre,
      'fecha',   a.created_at,
      'autor',   nullif(trim(coalesce(p.nombre,'') || ' ' || coalesce(p.apellido,'')), ''),
      'anulado', a.anulado_en is not null,
      'anulado_motivo', a.anulado_motivo
    ) as d
    from vehiculo_archivo a
    join vehiculo v on v.id = a.vehiculo_id
    left join profile p on p.id = a.autor_id
    where v.empresa_id = p_empresa
      and (p_patente is null
           or v.patente = upper(regexp_replace(p_patente, '[^A-Za-z0-9]', '', 'g')))
    order by a.created_at desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_salto, 0), 0)
  ) t
$$;

create or replace function integracion_registrar_acceso(
  p_api_key_id uuid, p_prefijo text, p_recurso text,
  p_filas integer, p_status integer, p_ip text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into integracion_log (api_key_id, prefijo, recurso, filas, status, ip)
  values (p_api_key_id, p_prefijo, p_recurso, p_filas, p_status, p_ip)
$$;

-- ── 6. Quién puede llamar todo esto ───────────────────────────────
-- NADIE desde el navegador. Ni `anon` ni `authenticated` tienen permiso de
-- ejecución: solo service_role, es decir, solo la Edge Function. Un usuario de
-- SAU con sesión no puede invocar ninguna de estas funciones.

do $$
declare f text;
begin
  foreach f in array array[
    'integracion_crear_clave(uuid,text,text[],integer)',
    'integracion_validar_clave(text,text)',
    'integracion_resumen(uuid)',
    'integracion_vehiculos(uuid,text,integer,integer)',
    'integracion_movimientos(uuid,date,date,integer,integer)',
    'integracion_facturacion(uuid,text,integer,integer)',
    'integracion_adjuntos(uuid,text,integer,integer)',
    'integracion_registrar_acceso(uuid,text,text,integer,integer,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Control: ninguna de estas funciones ejecutable por el navegador, y las dos
-- tablas sin una sola policy.
select json_build_object(
  'funciones', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'integracion\_%'),
  'ejecutables_por_authenticated', (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'integracion\_%'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  'ejecutables_por_anon', (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'integracion\_%'
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'tablas_con_rls_sin_policies', (select json_agg(c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'integracion\_%' and c.relrowsecurity
      and not exists (select 1 from pg_policies pp where pp.tablename = c.relname)),
  'credenciales_existentes', (select count(*) from integracion_api_key)
) as resultado;
