-- Lo mínimo que necesita la base para el chat de SAU IA dentro del Taller.
--
-- Son dos cosas y nada más: un canal nuevo para las conversaciones, y la única
-- consulta que PostgREST no sabe hacer.
--
-- Todo lo demás —aislamiento por empresa, filtro de importes, qué vehículos
-- existen para quién— ya lo resuelve la RLS del taller y no se toca. Eso es a
-- propósito: el chat consulta con la sesión del usuario, así que las policies
-- que escribimos en 0025/0026 son las que deciden qué puede ver, sin que haya
-- que repetir una sola regla acá.

-- ── 1. El canal de la conversación ───────────────────────────────
-- Se reutiliza caso/caso_mensaje: ya tienen RLS por empresa y guardan el
-- transcript completo, que es exactamente lo que hace falta para el contexto.
--
-- Queda anotado que caso.estado ('nuevo', 'propuesta_enviada', 'agendado'…)
-- no significa nada para una charla interna: la tabla se diseñó para casos de
-- clientes externos. Para el MVP no molesta. Si esto crece, una tabla propia
-- es más honesta que seguir estirando ésta.

alter table caso drop constraint if exists caso_canal_check;
alter table caso add constraint caso_canal_check
  check (canal in ('chat_prueba', 'whatsapp', 'chat_taller'));

comment on column caso.canal is
  'De dónde viene la charla. chat_taller es SAU IA adentro del módulo Taller: la conversación de un usuario de la empresa con sus propios datos, no la de un cliente externo.';

-- ── 2. La única consulta que no se puede armar desde el navegador ─
--
-- PostgREST no hace group by, y contar agrupando es justamente lo que pide la
-- mitad de las preguntas: cuántos vehículos por productor, por compañía, por
-- modelo. La alternativa era traer todas las filas y que las contara el
-- modelo, que es caro y además cuenta mal.
--
-- SECURITY INVOKER —el default, escrito igual para que se vea— porque es todo
-- el punto: la función corre como quien la llama y la RLS de `vehiculo`
-- decide qué filas entran en el conteo. Un usuario de otra empresa recibe
-- cero, sin que esta función sepa nada de empresas.
--
-- El campo a agrupar NO arma SQL: entra por un CASE sobre una lista cerrada.
-- No hay forma de pedir una columna que no esté en esa lista, ni de inyectar
-- nada, porque nunca se concatena texto en una consulta.

create or replace function public.taller_ia_contar_por(
  p_campo              text,
  p_desde              date    default null,
  p_hasta              date    default null,
  p_etapa              text    default null,
  p_incluir_entregados boolean default true
)
returns table (valor text, cantidad bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(nullif(trim(
      case p_campo
        when 'productor' then v.productor
        when 'compania'  then v.compania
        when 'vehiculo'  then v.vehiculo
        when 'etapa'     then v.etapa
        when 'excepcion' then v.excepcion
      end), ''), '(sin dato)') as valor,
    count(*) as cantidad
    from public.vehiculo v
   where p_campo in ('productor', 'compania', 'vehiculo', 'etapa', 'excepcion')
     -- Un ingreso anulado no es trabajo: no cuenta en ninguna estadística.
     and v.anulado_en is null
     and (coalesce(p_incluir_entregados, true) or v.etapa <> 'entregado')
     and (p_etapa is null or v.etapa = p_etapa)
     and (p_desde is null or v.fecha_ingreso >= p_desde)
     and (p_hasta is null or v.fecha_ingreso <= p_hasta)
   group by 1
   order by 2 desc, 1
   limit 50
$$;

revoke all on function public.taller_ia_contar_por(text, date, date, text, boolean) from public;
grant execute on function public.taller_ia_contar_por(text, date, date, text, boolean) to authenticated;
