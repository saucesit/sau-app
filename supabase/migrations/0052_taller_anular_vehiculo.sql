-- Un vehículo cargado por error tiene que poder salir del circuito, y hoy no
-- puede: taller.eliminar está reservado a SAU, así que el cliente depende de
-- que lo llamemos nosotros. Eso no es un circuito cerrado.
--
-- Anular NO es borrar. Es exactamente el mismo criterio que ya usamos con los
-- adjuntos: la fila se queda, los archivos se quedan, los eventos se quedan,
-- los importes y la facturación se quedan. Lo único que cambia es que el
-- vehículo deja de contar como trabajo vigente.
--
-- La definición operativa de "vigente" estaba escrita en veinte lugares como
-- `etapa <> 'entregado'`. Eso alcanzaba mientras entregado fuera la única
-- forma de salir. Ahora hay dos, así que la condición pasa a ser
-- `anulado_en is null` además de la etapa, y hay que tocarla en todos lados:
-- un anulado que sigue sumando en un KPI es peor que no poder anular.

-- ── 1. La marca ───────────────────────────────────────────────────

alter table vehiculo
  add column if not exists anulado_en     timestamptz,
  -- A auth.users, igual que vehiculo_archivo.anulado_por: el nombre para
  -- mostrar se resuelve después contra profile, que tiene el mismo id.
  add column if not exists anulado_por    uuid references auth.users(id) on delete set null,
  add column if not exists anulado_motivo text;

comment on column vehiculo.anulado_en is
  'Cuándo se anuló el ingreso. Con valor, el vehículo sale del circuito activo pero conserva todo: archivos, eventos, importes y facturación.';
comment on column vehiculo.anulado_motivo is
  'Por qué se anuló. Obligatorio: lo exige taller_anular_vehiculo.';

create index if not exists idx_vehiculo_anulado on vehiculo (empresa_id, anulado_en);

-- ── 2. Dos movimientos nuevos en la bitácora ─────────────────────

alter table vehiculo_evento drop constraint if exists vehiculo_evento_tipo_check;
alter table vehiculo_evento add constraint vehiculo_evento_tipo_check
  check (tipo in ('ingreso', 'nota', 'trabajo_hecho', 'avance', 'excepcion',
                  'cobro', 'entrega', 'facturacion', 'edicion', 'anulacion',
                  'monto', 'retroceso', 'reapertura',
                  'anulacion_vehiculo', 'restauracion_vehiculo'));

-- ── 3. Las tres columnas no se tocan a mano ──────────────────────
-- Mismo mecanismo que el resto del flujo: solo se mueven con la bandera de
-- sesión puesta, y la bandera la pone únicamente la función que corresponde.
-- Sin esto, un PATCH de PostgREST podría anular un vehículo sin motivo, sin
-- autor y sin dejar nada en la bitácora.

create or replace function public.taller_guardia_flujo()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('taller.flujo', true), '') <> 'on' then
    if new.etapa           is distinct from old.etapa
    or new.etapa_desde     is distinct from old.etapa_desde
    or new.trabajo_hecho   is distinct from old.trabajo_hecho
    or new.excepcion       is distinct from old.excepcion
    or new.excepcion_desde is distinct from old.excepcion_desde
    or new.fecha_entrega   is distinct from old.fecha_entrega
    or new.empresa_id      is distinct from old.empresa_id
    then
      raise exception 'El flujo del vehículo solo se modifica con las funciones del taller';
    end if;

    if new.anulado_en     is distinct from old.anulado_en
    or new.anulado_por    is distinct from old.anulado_por
    or new.anulado_motivo is distinct from old.anulado_motivo
    then
      raise exception 'Anular o restaurar un vehículo se hace con las funciones del taller, no editando la ficha';
    end if;

    -- La regla nueva. old.etapa: cuando se entrega, el cambio de etapa viene en
    -- este mismo UPDATE y la fecha de ingreso no se está tocando.
    if old.etapa = 'entregado'
       and new.fecha_ingreso is distinct from old.fecha_ingreso
    then
      raise exception 'La fecha de ingreso de un vehículo entregado no se modifica: cambiaría cuánto tardó un trabajo ya cerrado';
    end if;
  end if;
  return new;
end;
$$;

-- Y un anulado no sigue moviéndose por el circuito: ni avanza, ni retrocede,
-- ni se entrega, ni cambia de excepción. Está afuera.
create or replace function public.taller_guardia_anulado()
returns trigger
language plpgsql
as $$
begin
  -- Solo importa cuando ya estaba anulado y sigue anulado: restaurarlo es
  -- justamente levantar la marca, y eso tiene su propia función.
  if old.anulado_en is not null and new.anulado_en is not null then
    if new.etapa         is distinct from old.etapa
    or new.trabajo_hecho is distinct from old.trabajo_hecho
    or new.excepcion     is distinct from old.excepcion
    or new.fecha_entrega is distinct from old.fecha_entrega
    then
      raise exception 'Este vehículo está anulado: restauralo antes de volver a moverlo';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taller_guardia_anulado on vehiculo;
create trigger trg_taller_guardia_anulado
  before update on vehiculo
  for each row execute function public.taller_guardia_anulado();

-- ── 4. Anular ─────────────────────────────────────────────────────

create or replace function public.taller_anular_vehiculo(
  p_vehiculo uuid,
  p_motivo   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_etapa   text;
  v_anulado timestamptz;
  v_motivo  text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then
    raise exception 'Decí por qué se anula este ingreso: queda registrado en el reporte diario';
  end if;

  select empresa_id, etapa, anulado_en
    into v_empresa, v_etapa, v_anulado
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;

  -- Sacar un vehículo del circuito se lleva puestos sus importes de los
  -- totales y lo borra de la pizarra. Va con empresa.admin, igual que reabrir.
  if not tiene_permiso_taller(v_empresa, 'empresa.admin') then
    raise exception 'Anular un ingreso lo hace quien administra el taller';
  end if;

  if v_anulado is not null then
    raise exception 'Este ingreso ya está anulado';
  end if;

  -- Se puede anular un vehículo con facturación cargada: el caso real es
  -- justamente que alguien cargó todo en el auto equivocado. Nada de eso se
  -- borra, y la pantalla lo avisa antes de confirmar.
  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set anulado_en     = now(),
         anulado_por    = auth.uid(),
         anulado_motivo = v_motivo,
         updated_at     = now()
   where id = p_vehiculo;
  perform set_config('taller.flujo', '', true);

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'anulacion_vehiculo', v_etapa,
          'Ingreso anulado — ' || v_motivo);
end;
$$;

-- ── 5. Restaurar ──────────────────────────────────────────────────
-- Vuelve exactamente a donde estaba: no se reinicia la etapa, no se pierde el
-- trabajo marcado, no se tocan los importes. Lo único que se levanta es la
-- marca.

create or replace function public.taller_restaurar_vehiculo(
  p_vehiculo uuid,
  p_motivo   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa  uuid;
  v_etapa    text;
  v_patente  text;
  v_anulado  timestamptz;
  v_otra     record;
  v_motivo   text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then
    raise exception 'Decí por qué se restaura este ingreso: queda registrado en el reporte diario';
  end if;

  select empresa_id, etapa, patente, anulado_en
    into v_empresa, v_etapa, v_patente, v_anulado
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;

  if not tiene_permiso_taller(v_empresa, 'empresa.admin') then
    raise exception 'Restaurar un ingreso anulado lo hace quien administra el taller';
  end if;

  if v_anulado is null then
    raise exception 'Este ingreso no está anulado';
  end if;

  -- Volver al circuito activo es volver a competir por la patente. Mientras
  -- estuvo anulado pudieron cargar el auto de nuevo, y en ese caso restaurar
  -- dejaría dos órdenes abiertas del mismo vehículo. Se rechaza y lo resuelve
  -- una persona: acá no se elige cuál de las dos vale.
  --
  -- Un entregado no compite con nada, así que solo se mira si vuelve activo.
  if v_etapa <> 'entregado' then
    select v.fecha_ingreso, v.etapa into v_otra
      from vehiculo v
     where v.empresa_id = v_empresa
       and v.patente = v_patente
       and v.etapa <> 'entregado'
       and v.anulado_en is null
       and v.id <> p_vehiculo
     order by v.fecha_ingreso desc
     limit 1;

    if found then
      raise exception 'No se puede restaurar: % ya tiene otra orden activa (ingresó el %, está en %). Resolvé esa primero.',
        v_patente, to_char(v_otra.fecha_ingreso, 'DD/MM/YYYY'), v_otra.etapa;
    end if;
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set anulado_en     = null,
         anulado_por    = null,
         anulado_motivo = null,
         updated_at     = now()
   where id = p_vehiculo;
  perform set_config('taller.flujo', '', true);

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'restauracion_vehiculo', v_etapa,
          'Ingreso restaurado: vuelve al circuito en ' || v_etapa || ' — ' || v_motivo);
end;
$$;

revoke all on function public.taller_anular_vehiculo(uuid, text)    from public;
revoke all on function public.taller_restaurar_vehiculo(uuid, text) from public;
grant execute on function public.taller_anular_vehiculo(uuid, text)    to authenticated;
grant execute on function public.taller_restaurar_vehiculo(uuid, text) to authenticated;

-- ── 6. Un anulado no compite por la patente ──────────────────────
-- Si siguiera contando como orden activa, el auto no podría volver a entrar:
-- se habría cambiado "no puedo sacar el vehículo mal cargado" por "no puedo
-- cargar el bueno".

create or replace function public.taller_guardia_orden_duplicada()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_otra record;
begin
  if new.etapa = 'entregado' then
    return new;
  end if;

  -- Un vehículo anulado tampoco ocupa lugar: no es trabajo vigente.
  if new.anulado_en is not null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.patente is not distinct from old.patente
     and old.etapa <> 'entregado'
     and old.anulado_en is null then
    return new;
  end if;

  if new.orden_adicional then
    return new;
  end if;

  select v.fecha_ingreso, v.etapa into v_otra
    from public.vehiculo v
   where v.empresa_id = new.empresa_id
     and v.patente = new.patente
     and v.etapa <> 'entregado'
     and v.anulado_en is null
     and v.id <> new.id
   order by v.fecha_ingreso desc
   limit 1;

  if found then
    raise exception
      'Ya hay una orden activa de % (ingresó el %, está en %). Si de verdad es otra orden distinta, confirmalo al cargarla.',
      new.patente, to_char(v_otra.fecha_ingreso, 'DD/MM/YYYY'), v_otra.etapa;
  end if;

  return new;
end;
$$;

create or replace function public.taller_ordenes_activas(p_empresa uuid, p_patente text)
returns table (id uuid, patente text, vehiculo text, cliente_nombre text,
               etapa text, fecha_ingreso date)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select v.id, v.patente, v.vehiculo, v.cliente_nombre, v.etapa, v.fecha_ingreso
    from public.vehiculo v
   where v.empresa_id = p_empresa
     and v.patente = upper(regexp_replace(coalesce(p_patente, ''), '[^A-Za-z0-9]', '', 'g'))
     and v.etapa <> 'entregado'
     and v.anulado_en is null
     and public.tiene_permiso_taller(v.empresa_id, 'taller.ver')
   order by v.fecha_ingreso desc
$$;

revoke all on function public.taller_ordenes_activas(uuid, text) from public;
grant execute on function public.taller_ordenes_activas(uuid, text) to authenticated;

-- ── 7. Reabrir un entregado tampoco choca con un anulado ─────────
-- La comprobación de 0048 miraba solo la etapa.

create or replace function taller_reabrir_vehiculo(
  p_vehiculo uuid,
  p_motivo   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa  uuid;
  v_etapa    text;
  v_patente  text;
  v_anulado  timestamptz;
  v_otra     record;
  v_motivo   text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if v_motivo is null then
    raise exception 'Decí por qué volvés este vehículo al taller: queda registrado en el reporte diario';
  end if;

  select empresa_id, etapa, patente, anulado_en
    into v_empresa, v_etapa, v_patente, v_anulado
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;

  if not tiene_permiso_taller(v_empresa, 'empresa.admin') then
    raise exception 'Reabrir un vehículo entregado lo hace quien administra el taller';
  end if;

  if v_anulado is not null then
    raise exception 'Este ingreso está anulado: restauralo antes de reabrirlo';
  end if;

  if v_etapa <> 'entregado' then
    raise exception 'Este vehículo no está entregado (está en %)', v_etapa;
  end if;

  select v.patente, v.fecha_ingreso, v.etapa into v_otra
    from vehiculo v
   where v.empresa_id = v_empresa
     and v.patente = v_patente
     and v.etapa <> 'entregado'
     and v.anulado_en is null
     and v.id <> p_vehiculo
   order by v.fecha_ingreso desc
   limit 1;

  if found then
    raise exception 'No se puede reabrir: % ya tiene una orden activa (ingresó el %, está en %). Cerrá o resolvé esa antes.',
      v_patente, to_char(v_otra.fecha_ingreso, 'DD/MM/YYYY'), v_otra.etapa;
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set etapa = 'control_calidad',
         etapa_desde = now(),
         fecha_entrega = null,
         trabajo_hecho = false,
         updated_at = now()
   where id = p_vehiculo;
  perform set_config('taller.flujo', '', true);

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'reapertura', 'control_calidad',
          'Reabierto: vuelve al taller en Control de Calidad — ' || v_motivo);
end;
$$;

-- ── 8. Ninguna función del flujo mueve un anulado ────────────────
-- El trigger ya lo frena, pero el mensaje que da es genérico. Estas dos son
-- las puertas por donde se entra, y conviene que digan qué pasa.

create or replace function public.taller_validar_avance(p_vehiculo uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_empresa uuid; v_etapa text; v_hecho boolean; v_excepcion text; v_anulado timestamptz;
  v_etapas text[] := taller_etapas();
  v_idx int; v_siguiente text;
begin
  select empresa_id, etapa, trabajo_hecho, excepcion, anulado_en
    into v_empresa, v_etapa, v_hecho, v_excepcion, v_anulado
    from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.validar') then
    raise exception 'No tenés permiso para validar el avance';
  end if;
  if v_anulado is not null then
    raise exception 'Este ingreso está anulado: restauralo antes de avanzarlo';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;
  if v_etapa = 'control_calidad' then
    raise exception 'Para pasar a Entregado usá la función de entrega';
  end if;
  if v_excepcion = 'detenido' then
    raise exception 'El vehículo está detenido: levantá el estado antes de avanzarlo';
  end if;
  if v_etapa = any (taller_etapas_con_operario()) and not v_hecho then
    raise exception 'Falta que el operario marque el trabajo de % como realizado', v_etapa;
  end if;

  v_idx := array_position(v_etapas, v_etapa);
  v_siguiente := v_etapas[v_idx + 1];

  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set etapa = v_siguiente, etapa_desde = now(), trabajo_hecho = false, updated_at = now()
   where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'avance', v_siguiente, v_etapa || ' validada — pasa a ' || v_siguiente);

  return v_siguiente;
end;
$$;

create or replace function public.taller_marcar_trabajo_hecho(p_vehiculo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_empresa  uuid;
  v_etapa    text;
  v_hecho    boolean;
  v_anulado  timestamptz;
  v_etapas   text[];
  v_miembro  boolean;
begin
  select empresa_id, etapa, trabajo_hecho, anulado_en
    into v_empresa, v_etapa, v_hecho, v_anulado
    from vehiculo where id = p_vehiculo for update;

  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.trabajar') then
    raise exception 'No tenés permiso para marcar trabajo realizado';
  end if;
  if v_anulado is not null then
    raise exception 'Este ingreso está anulado: no hay trabajo que marcar';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;
  if not (v_etapa = any (taller_etapas_con_operario())) then
    raise exception 'En % no hay trabajo de operario para marcar', v_etapa;
  end if;

  select true, coalesce(m.taller_etapas, '{}')
    into v_miembro, v_etapas
    from membresia m
   where m.usuario_id = auth.uid() and m.empresa_id = v_empresa and m.activa
   limit 1;

  if v_miembro is null then
    if not es_contadora_o_admin() then
      raise exception 'No pertenecés a esta empresa';
    end if;
  else
    if coalesce(array_length(v_etapas, 1), 0) = 0 then
      raise exception 'Todavía no tenés etapas habilitadas. Pedile al encargado que configure tu oficio en el taller';
    end if;
    if not (v_etapa = any (v_etapas)) then
      raise exception 'No estás habilitado para marcar trabajo en %', v_etapa;
    end if;
  end if;

  if v_hecho then
    raise exception 'Este trabajo ya fue marcado como realizado';
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo set trabajo_hecho = true, updated_at = now() where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'trabajo_hecho', v_etapa, 'Trabajo marcado como realizado');
end;
$$;

grant execute on function public.taller_validar_avance(uuid)        to authenticated;
grant execute on function public.taller_marcar_trabajo_hecho(uuid)  to authenticated;

-- ── 9. La integración no reporta anulados ────────────────────────
-- Los cinco recursos son un reporte operativo: lo que se anuló no es trabajo
-- y no tiene por qué viajar afuera, ni siquiera bajo p_estado = 'todos'.
-- Quien quiera auditar una anulación la tiene en la pantalla, con su motivo y
-- su autor, que es donde corresponde.

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
         where empresa_id = p_empresa and etapa <> 'entregado'
           and anulado_en is null group by 1) x),
    'fuera_de_plazo', count(*) filter (
       where etapa <> 'entregado' and fecha_pactada is not null and fecha_pactada < current_date),
    'sin_fecha_pactada', count(*) filter (
       where etapa <> 'entregado' and fecha_pactada is null),
    'con_excepcion', (select coalesce(json_object_agg(ex, n), '{}'::json) from
       (select excepcion ex, count(*) n from vehiculo
         where empresa_id = p_empresa and etapa <> 'entregado' and excepcion is not null
           and anulado_en is null
         group by 1) y))
  from vehiculo where empresa_id = p_empresa and anulado_en is null
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
      and anulado_en is null
      and (p_estado = 'todos'
        or (p_estado = 'activos'    and etapa <> 'entregado')
        or (p_estado = 'entregados' and etapa =  'entregado'))
    order by fecha_ingreso desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_desde, 0), 0)
  ) t
$$;

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
      and v.anulado_en is null
      and ev.created_at >= r.desde
      and ev.created_at < r.hasta + 1
    order by ev.created_at desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_salto, 0), 0)
  ) t
$$;

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
      and v.anulado_en is null
      and (p_estado = 'todos'
        or (p_estado = 'activos'    and v.etapa <> 'entregado')
        or (p_estado = 'entregados' and v.etapa =  'entregado'))
    order by v.fecha_ingreso desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_salto, 0), 0)
  ) t
$$;

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
      and v.anulado_en is null
      and (p_patente is null
           or v.patente = upper(regexp_replace(p_patente, '[^A-Za-z0-9]', '', 'g')))
    order by a.created_at desc
    limit least(coalesce(p_limite, 200), 200) offset greatest(coalesce(p_salto, 0), 0)
  ) t
$$;
