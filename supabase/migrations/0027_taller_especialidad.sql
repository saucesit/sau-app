-- Especialidad del operario.
--
-- Hasta acá un operario podía marcar trabajo realizado en cualquier vehículo de
-- su empresa que estuviera en una etapa con operario: el chapista podía dar por
-- terminado un auto que estaba en Pintura.
--
-- Esto NO es asignación de responsables por vehículo (eso quedó para una segunda
-- etapa): es limitar a cada uno a su oficio.
--
-- Sin especialidad cargada el comportamiento es el de antes, para no dejar a
-- nadie sin poder trabajar el día que se publica. Conviene cargarla a todos.

alter table membresia
  add column if not exists taller_especialidad text
  check (taller_especialidad is null
         or taller_especialidad in ('chapa','preparacion','pintura','pre_entrega'));

comment on column membresia.taller_especialidad is
  'Etapa del taller en la que trabaja esta persona. NULL = sin restricción.';

create or replace function taller_marcar_trabajo_hecho(p_vehiculo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_etapa text; v_esp text;
begin
  select empresa_id, etapa into v_empresa, v_etapa from vehiculo where id = p_vehiculo for update;
  if v_empresa is null then raise exception 'El vehículo no existe'; end if;
  if not tiene_permiso_taller(v_empresa, 'taller.trabajar') then
    raise exception 'No tenés permiso para marcar trabajo realizado';
  end if;
  if v_etapa = 'entregado' then raise exception 'El vehículo ya fue entregado'; end if;
  if not (v_etapa = any (taller_etapas_con_operario())) then
    raise exception 'En % no hay trabajo de operario para marcar', v_etapa;
  end if;

  select m.taller_especialidad into v_esp
    from membresia m
   where m.usuario_id = auth.uid() and m.empresa_id = v_empresa and m.activa
   limit 1;

  if v_esp is not null and v_esp <> v_etapa then
    raise exception 'Tu especialidad es %, no podés marcar trabajo en %', v_esp, v_etapa;
  end if;

  perform set_config('taller.flujo', 'on', true);
  update vehiculo set trabajo_hecho = true, updated_at = now() where id = p_vehiculo;

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  values (p_vehiculo, 'trabajo_hecho', v_etapa, 'Trabajo marcado como realizado');
end;
$$;

grant execute on function taller_marcar_trabajo_hecho(uuid) to authenticated;
