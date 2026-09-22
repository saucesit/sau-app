-- Banco de pruebas del módulo taller: dos empresas nuevas y los cuatro roles.
-- No toca TALLER FORANI ni ningún dato demo.

do $$
declare
  v_a uuid := '11111111-aaaa-4aaa-8aaa-111111111111';
  v_b uuid := '22222222-bbbb-4bbb-8bbb-222222222222';
  v_pass text := 'PruebaTaller2026';
  r record;
  v_uid uuid;
begin
  -- Empresas
  insert into empresa (id, razon_social, nombre_fantasia, condicion_fiscal, modulos_activos)
  values (v_a, 'ZZ PRUEBA TALLER A', 'ZZ PRUEBA TALLER A', 'monotributo', array['taller']),
         (v_b, 'ZZ PRUEBA TALLER B', 'ZZ PRUEBA TALLER B', 'monotributo', array['taller'])
  on conflict (id) do update set modulos_activos = excluded.modulos_activos;

  -- Usuarios, uno por rol
  for r in
    select * from (values
      ('taller-a-operario@prueba.sau',    'Op A',      v_a, 'empleado', array['taller.ver','taller.trabajar'], array['chapa','preparacion','pintura','pre_entrega']),
      ('taller-a-pintor@prueba.sau',      'Pintor A',  v_a, 'empleado', array['taller.ver','taller.trabajar'], array['pintura']),
      ('taller-a-mixto@prueba.sau',       'Mixto A',   v_a, 'empleado', array['taller.ver','taller.trabajar'], array['chapa','preparacion']),
      ('taller-a-sinetapas@prueba.sau',   'SinEtapas', v_a, 'empleado', array['taller.ver','taller.trabajar'], array[]::text[]),
      ('taller-a-coordinador@prueba.sau', 'Coord A',   v_a, 'empleado', array['taller.ver','taller.trabajar','taller.cargar','taller.validar'], array['chapa','preparacion','pintura','pre_entrega']),
      ('taller-a-admin@prueba.sau',       'Admin A',   v_a, 'empleado', array['taller.ver','taller.cargar','taller.validar','taller.montos'], array[]::text[]),
      ('taller-a-completo@prueba.sau',    'Full A',    v_a, 'dueno',    array['taller.ver','taller.trabajar','taller.cargar','taller.validar','taller.montos','empresa.admin'], array['chapa','preparacion','pintura','pre_entrega']),
      ('taller-b-admin@prueba.sau',       'Admin B',   v_b, 'empleado', array['taller.ver','taller.cargar','taller.validar','taller.montos'], array[]::text[])
    ) as t(email, nombre, empresa, rol, permisos, etapas)
  loop
    select id into v_uid from auth.users where email = r.email;

    if v_uid is null then
      v_uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data
      ) values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
        r.email, crypt(v_pass, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
      );
    end if;

    insert into profile (id, nombre) values (v_uid, r.nombre)
    on conflict (id) do update set nombre = excluded.nombre;

    insert into membresia (usuario_id, empresa_id, rol, permisos, activa)
    values (v_uid, r.empresa, r.rol::rol_empresa, r.permisos, true)
    on conflict do nothing;

    update membresia
       set permisos = r.permisos, rol = r.rol::rol_empresa, taller_etapas = r.etapas
     where usuario_id = v_uid and empresa_id = r.empresa;
  end loop;

  -- GoTrue lee estas columnas como texto no nulo: si quedan en NULL falla el
  -- login con "Database error querying schema".
  update auth.users set
    confirmation_token         = coalesce(confirmation_token, ''),
    recovery_token             = coalesce(recovery_token, ''),
    email_change               = coalesce(email_change, ''),
    email_change_token_new     = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change               = coalesce(phone_change, ''),
    phone_change_token         = coalesce(phone_change_token, ''),
    reauthentication_token     = coalesce(reauthentication_token, '')
  where email like '%@prueba.sau';

  -- Limpieza de corridas anteriores, para que la suite se pueda repetir
  delete from vehiculo where empresa_id = v_a and patente like 'ZZESP%';

  -- Un vehículo de prueba en la empresa A, en chapa y sin trabajo marcado
  if not exists (select 1 from vehiculo where empresa_id = v_a and patente = 'ZZTEST01') then
    insert into vehiculo (empresa_id, patente, vehiculo, cliente_nombre, compania,
                          fecha_ingreso, fecha_pactada, etapa)
    values (v_a, 'ZZ TEST 01', 'FORD RANGER', 'CLIENTE DE PRUEBA', 'Particular',
            current_date - 3, current_date + 20, 'chapa');
  else
    -- Lo devolvemos al principio de la cadena. El trigger guardián exige la
    -- bandera de sesión incluso para un reset administrativo como este.
    perform set_config('taller.flujo', 'on', true);
    update vehiculo
       set etapa = 'chapa', etapa_desde = now(), trabajo_hecho = false,
           excepcion = null, excepcion_desde = null, fecha_entrega = null
     where empresa_id = v_a and patente = 'ZZTEST01';
    -- También los montos: la suite los edita, y si no se reinician la corrida
    -- siguiente arranca con valores de la anterior.
    update vehiculo_monto m
       set cobro_compania = false, cobro_franquicia = false, cobro_particular = false,
           monto_compania = 0, monto_franquicia = 0, monto_particular = 0
      from vehiculo v where v.id = m.vehiculo_id and v.patente = 'ZZTEST01';
  end if;
end $$;

select
  (select count(*) from empresa  where razon_social like 'ZZ PRUEBA%')                  as empresas,
  (select count(*) from auth.users where email like '%@prueba.sau')                     as usuarios,
  (select count(*) from vehiculo where patente = 'ZZTEST01')                            as vehiculo_prueba,
  (select count(*) from vehiculo_monto m join vehiculo v on v.id = m.vehiculo_id
     where v.patente = 'ZZTEST01')                                                      as monto_autocreado,
  (select count(*) from vehiculo_evento e join vehiculo v on v.id = e.vehiculo_id
     where v.patente = 'ZZTEST01' and e.tipo = 'ingreso')                               as evento_ingreso;
