-- Dos órdenes activas del mismo auto: a propósito sí, por error no.
--
-- En 0040 sacamos la unicidad de patente entre los activos, porque el taller
-- de verdad tiene el mismo auto con dos órdenes abiertas. Pero quedó sin red:
-- cargar dos veces la misma patente por distracción pasaba sin que nadie
-- avisara, y el resultado son dos fichas del mismo trabajo.
--
-- La solución no puede ser un índice único, porque los casos legítimos existen
-- y son cuatro ya en el Excel. Tiene que ser una confirmación explícita:
--
--   * Al cargar un vehículo cuya patente YA tiene una orden activa, se rechaza.
--   * Salvo que quien lo carga diga que sabe lo que está haciendo, marcando
--     `orden_adicional`. La pantalla se lo pregunta mostrándole la orden que ya
--     existe, con su fecha de ingreso y su etapa.
--
-- Queda guardado en la fila, no en una bandera de sesión: dentro de seis meses
-- se puede saber cuáles se cargaron sabiendo que había otra abierta.

alter table vehiculo
  add column if not exists orden_adicional boolean not null default false;

comment on column vehiculo.orden_adicional is
  'Se cargó sabiendo que el mismo auto ya tenía una orden activa. Lo confirma quien carga; sin esto el alta se rechaza.';

create or replace function public.taller_guardia_orden_duplicada()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_otra record;
begin
  -- Un entregado no compite con nada: la patente puede repetirse libremente en
  -- el histórico, que es lo normal cuando un auto vuelve.
  if new.etapa = 'entregado' then
    return new;
  end if;

  -- En UPDATE solo se revisa si la patente cambió o si el vehículo volvió del
  -- histórico. Si no, editar un teléfono de una de dos órdenes legítimas
  -- fallaría por existir la otra.
  if tg_op = 'UPDATE'
     and new.patente is not distinct from old.patente
     and old.etapa <> 'entregado' then
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

drop trigger if exists trg_taller_guardia_orden_duplicada on vehiculo;
create trigger trg_taller_guardia_orden_duplicada
  before insert or update on vehiculo
  for each row execute function public.taller_guardia_orden_duplicada();

-- Para que la pantalla pueda avisar ANTES de que el alta falle: devuelve las
-- órdenes activas de esa patente, si hay. Respeta los permisos del taller.
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
     and public.tiene_permiso_taller(p_empresa, 'taller.ver')
   order by v.fecha_ingreso desc
$$;

grant execute on function public.taller_ordenes_activas(uuid, text) to authenticated;
