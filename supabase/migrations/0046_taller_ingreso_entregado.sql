-- La fecha de ingreso de un vehículo entregado no se reescribe.
--
-- Es una regla de negocio, no una comodidad de pantalla: una vez entregado el
-- auto, mover su fecha de ingreso cambia retroactivamente cuánto tardó un
-- trabajo ya cerrado. La ficha ya no lo deja, pero eso solo cubre el navegador;
-- acá se cierra para cualquiera que llame a la API.
--
-- Mientras el vehículo está adentro del taller, la fecha de ingreso se sigue
-- corrigiendo con taller.cargar —se carga mal seguido, sobre todo cuando entran
-- tres autos juntos— y queda en la bitácora como cualquier otro cambio.
--
-- Los otros doce campos del expediente se siguen pudiendo corregir en un
-- entregado: un teléfono mal anotado o un número de siniestro se arreglan igual
-- dos meses después, y ninguno reescribe la historia del trabajo.
--
-- Dónde va: adentro de taller_guardia_flujo, que es la guardia del ciclo de
-- vida del vehículo y la que ya decide qué se puede mover y qué no. Va bajo la
-- bandera de sesión, igual que el resto de esa función: eso deja cerrada la
-- puerta de la API —nadie puede poner la bandera desde un JWT— y conserva el
-- camino administrativo desde la base, que es el que usan los seeds y el que
-- haría falta si algún día hay que corregir un dato viejo a propósito.
--
-- Se mira `old.etapa`, no `new.etapa`: al entregar un auto la etapa pasa a
-- 'entregado' en ese mismo UPDATE, y ahí la fecha de ingreso no está cambiando.
-- Mirar la nueva haría fallar la entrega misma.

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

comment on function public.taller_guardia_flujo() is
  'Guardia del ciclo de vida del vehículo: etapa, trabajo, excepción, entrega y empresa van por las funciones del taller, y la fecha de ingreso de un entregado no se reescribe.';

-- Control: la regla viva y el resto de la guardia en pie.
select json_build_object(
  'regla_ingreso_entregado', (select pg_get_functiondef(oid) like '%trabajo ya cerrado%'
     from pg_proc where proname = 'taller_guardia_flujo'),
  'sigue_guardando_el_flujo', (select pg_get_functiondef(oid) like '%funciones del taller%'
     from pg_proc where proname = 'taller_guardia_flujo'),
  'trigger_vivo', (select count(*) from pg_trigger
     where tgname = 'trg_taller_guardia_flujo')
) as resultado;
