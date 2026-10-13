-- El expediente se completa después del alta, y todo cambio deja rastro.
--
-- La asesora carga rápido cuando llegan tres autos juntos y vuelve más tarde a
-- completar. Hasta hoy los trece datos del alta quedaban congelados en la
-- pantalla —en la base nunca lo estuvieron: la policy vehiculo_update los deja
-- pasar a todos con taller.cargar—, así que esto es, otra vez, abrir la
-- pantalla y cerrar lo que estaba abierto sin registro.
--
-- Dos partes:
--   1. taller_registrar_edicion pasa de registrar 5 campos a registrar los 13.
--      Era el agujero real: ocho datos del expediente podían cambiar sin que
--      quedara una línea en la bitácora.
--   2. Una guardia nueva cierra cuatro columnas que nunca deberían moverse por
--      un UPDATE: id, created_at, origen_import y orden_adicional.
--
-- Lo que NO cambia:
--   * Ningún permiso. taller.cargar ya era "da de alta y edita la ficha", y es
--     justamente lo que el Operario no tiene.
--   * La guardia de duplicados, que sigue disparando si se cambia una patente
--     por otra que ya tiene orden activa.
--   * La guardia de flujo: etapa, trabajo hecho, excepción, fecha de entrega y
--     empresa se siguen moviendo solo con las funciones del taller.

-- ── 1. Los trece campos, auditados ────────────────────────────────
-- Mismo formato para todos: "campo: antes → después". El autor y la fecha los
-- pone trg_taller_evento_autor sobre el evento que se inserta acá, con
-- auth.uid(), que adentro de una función definer sigue siendo quien llamó.

create or replace function public.taller_registrar_edicion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cambios text[] := '{}';
  v_texto   text;

  -- Un cambio en texto legible. '—' para lo que estaba vacío, así se lee
  -- igual completar un dato que corregirlo.
  v_nada constant text := '—';
begin
  if new.patente is distinct from old.patente then
    v_cambios := v_cambios || ('patente: ' || coalesce(old.patente, v_nada) ||
                               ' → ' || coalesce(new.patente, v_nada));
  end if;
  if new.vehiculo is distinct from old.vehiculo then
    v_cambios := v_cambios || ('vehículo: ' || coalesce(old.vehiculo, v_nada) ||
                               ' → ' || coalesce(new.vehiculo, v_nada));
  end if;
  if new.kilometraje is distinct from old.kilometraje then
    v_cambios := v_cambios || ('kilometraje: ' || coalesce(old.kilometraje::text, v_nada) ||
                               ' → ' || coalesce(new.kilometraje::text, v_nada));
  end if;
  if new.cliente_nombre is distinct from old.cliente_nombre then
    v_cambios := v_cambios || ('cliente: ' || coalesce(old.cliente_nombre, v_nada) ||
                               ' → ' || coalesce(new.cliente_nombre, v_nada));
  end if;
  if new.telefono is distinct from old.telefono then
    v_cambios := v_cambios || ('teléfono: ' || coalesce(old.telefono, v_nada) ||
                               ' → ' || coalesce(new.telefono, v_nada));
  end if;
  if new.panos is distinct from old.panos then
    v_cambios := v_cambios || ('paños: ' || coalesce(old.panos::text, v_nada) ||
                               ' → ' || coalesce(new.panos::text, v_nada));
  end if;
  if new.dias_chapa is distinct from old.dias_chapa then
    v_cambios := v_cambios || ('días de chapa: ' || coalesce(old.dias_chapa::text, v_nada) ||
                               ' → ' || coalesce(new.dias_chapa::text, v_nada));
  end if;
  if new.compania is distinct from old.compania then
    v_cambios := v_cambios || ('compañía: ' || coalesce(old.compania, v_nada) ||
                               ' → ' || coalesce(new.compania, v_nada));
  end if;
  if new.productor is distinct from old.productor then
    v_cambios := v_cambios || ('productor: ' || coalesce(old.productor, v_nada) ||
                               ' → ' || coalesce(new.productor, v_nada));
  end if;
  if new.perito is distinct from old.perito then
    v_cambios := v_cambios || ('perito: ' || coalesce(old.perito, v_nada) ||
                               ' → ' || coalesce(new.perito, v_nada));
  end if;
  if new.nro_siniestro is distinct from old.nro_siniestro then
    v_cambios := v_cambios || ('N° de siniestro: ' || coalesce(old.nro_siniestro, v_nada) ||
                               ' → ' || coalesce(new.nro_siniestro, v_nada));
  end if;
  if new.fecha_ingreso is distinct from old.fecha_ingreso then
    v_cambios := v_cambios || ('fecha de ingreso: ' || coalesce(to_char(old.fecha_ingreso, 'DD/MM/YYYY'), v_nada) ||
                               ' → ' || coalesce(to_char(new.fecha_ingreso, 'DD/MM/YYYY'), v_nada));
  end if;
  if new.fecha_pactada is distinct from old.fecha_pactada then
    v_cambios := v_cambios || ('fecha pactada: ' || coalesce(to_char(old.fecha_pactada, 'DD/MM/YYYY'), v_nada) ||
                               ' → ' || coalesce(to_char(new.fecha_pactada, 'DD/MM/YYYY'), v_nada));
  end if;

  if array_length(v_cambios, 1) > 0 then
    v_texto := array_to_string(v_cambios, ' · ');
    insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
    values (new.id, 'edicion', new.etapa, v_texto);
  end if;
  return new;
end;
$$;

comment on function public.taller_registrar_edicion() is
  'Registra en la bitácora cualquier cambio de los trece datos del alta, con valor anterior y nuevo. El autor lo pone trg_taller_evento_autor.';

-- ── 2. Las cuatro columnas estructurales ──────────────────────────
-- No son datos del expediente: son su identidad y sus llaves.
--
--   id              la clave primaria
--   created_at      cuándo se cargó de verdad
--   origen_import   la clave de idempotencia del import, con índice único
--   orden_adicional la bandera que desactiva la guardia de duplicados
--
-- La bandera se pone al dar de alta —ahí la pantalla pregunta y muestra la
-- orden que ya existe— y después no se toca. Por eso la guardia es sobre
-- UPDATE y no sobre INSERT: el alta legítima de una segunda orden sigue
-- funcionando igual, porque llega como INSERT con la bandera ya puesta.
--
-- Va aparte de taller_guardia_flujo y SIN la bandera de sesión: el flujo se
-- destraba a propósito para los resets administrativos, y esto no tiene que
-- destrabarse nunca. Si alguna vez hace falta marcar una orden existente como
-- adicional, que sea con una función específica que deje el movimiento escrito.

create or replace function public.taller_guardia_estructura()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'El identificador del vehículo no se cambia';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'La fecha de carga del vehículo no se cambia';
  end if;
  if new.origen_import is distinct from old.origen_import then
    raise exception 'El origen de importación no se cambia: es lo que evita que una importación repetida duplique vehículos';
  end if;
  if new.orden_adicional is distinct from old.orden_adicional then
    raise exception 'La marca de orden adicional se define al dar de alta el vehículo y después no se modifica';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taller_guardia_estructura on vehiculo;
create trigger trg_taller_guardia_estructura
  before update on vehiculo
  for each row execute function public.taller_guardia_estructura();

-- Control: las dos piezas vivas y el orden de los triggers de UPDATE.
select json_build_object(
  'campos_auditados', (select count(*) from pg_proc p,
     lateral regexp_matches(pg_get_functiondef(p.oid), 'v_cambios := v_cambios', 'g')
     where p.proname = 'taller_registrar_edicion'),
  'guardia_estructura', (select count(*) from pg_trigger
     where tgname = 'trg_taller_guardia_estructura'),
  'triggers_update', (select json_agg(tgname order by tgname) from pg_trigger
     where tgrelid = 'vehiculo'::regclass and not tgisinternal)
) as resultado;
