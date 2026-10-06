-- Usuarios del entorno LOCAL de pruebas.
--
-- Va aparte de supabase/seed.sql a propósito: acá se crean contraseñas, y
-- ninguna contraseña queda versionada. La clave se pasa por parámetro:
--
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v clave="LaQueVosElijas" \
--        -f scripts/seed-usuarios-locales.sql
--
-- NUNCA correr esto contra producción. Crea usuarios en auth.users
-- directamente, que es aceptable en una base descartable y no en una real.
--
-- Depende de supabase/seed.sql: las empresas ficticias tienen que existir.

\set ON_ERROR_STOP on

-- Pasa la variable de psql a un parámetro de sesión, que es lo que el bloque
-- de abajo puede leer. No queda escrita en ningún lado.
select set_config('seed.clave', :'clave', false);

do $$
declare
  v_taller   uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_comercio uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_clave    text := current_setting('seed.clave', true);
  v_uid      uuid;
  r          record;
begin
  if v_clave is null or length(v_clave) < 8 then
    raise exception 'Falta la clave. Pasala con -v clave="…" (mínimo 8 caracteres)';
  end if;

  for r in
    select * from (values
      -- email, nombre, empresa, rol, permisos, etapas del taller
      ('duena@local.test', 'Dueña', v_taller, 'dueno',
       array['taller.ver','taller.cargar','taller.trabajar','taller.validar','taller.montos',
             'equipo.ver','reportes.ver','empresa.admin'],
       array['chapa','preparacion','pintura','terminacion']),

      ('encargado@local.test', 'Encargado', v_taller, 'empleado',
       array['taller.ver','taller.cargar','taller.validar','taller.montos'],
       array[]::text[]),

      ('chapista@local.test', 'Chapista', v_taller, 'empleado',
       array['taller.ver','taller.trabajar'],
       array['chapa','preparacion']),

      ('pintor@local.test', 'Pintor', v_taller, 'empleado',
       array['taller.ver','taller.trabajar'],
       array['pintura','terminacion']),

      ('recepcion@local.test', 'Recepción', v_taller, 'empleado',
       array['taller.ver','taller.cargar'],
       array[]::text[]),

      -- Reproduce a propósito el caso que quedó abierto: permiso para trabajar
      -- pero sin etapas cargadas, así se puede probar qué ve esa persona.
      ('sinetapas@local.test', 'Sin Etapas', v_taller, 'empleado',
       array['taller.ver','taller.trabajar'],
       array[]::text[]),

      ('almacen@local.test', 'Almacenero', v_comercio, 'dueno',
       array['ventas.ver','ventas.crear','caja.ver','caja.operar',
             'stock.ver','fiado.ver','fiado.crear','equipo.ver','empresa.admin'],
       array[]::text[])
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
        r.email, crypt(v_clave, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
      );
    else
      update auth.users set encrypted_password = crypt(v_clave, gen_salt('bf'))
       where id = v_uid;
    end if;

    insert into profile (id, nombre) values (v_uid, r.nombre)
      on conflict (id) do update set nombre = excluded.nombre;

    insert into membresia (usuario_id, empresa_id, rol, permisos, taller_etapas, activa)
    values (v_uid, r.empresa, r.rol::rol_empresa, r.permisos, r.etapas, true)
    on conflict (usuario_id, empresa_id) do update
      set rol = excluded.rol, permisos = excluded.permisos,
          taller_etapas = excluded.taller_etapas, activa = true;
  end loop;

  -- GoTrue explota con "Database error querying schema" si estas columnas
  -- quedan en NULL en vez de cadena vacía. Pasa al insertar a mano en auth.users.
  update auth.users set
    confirmation_token         = coalesce(confirmation_token, ''),
    recovery_token             = coalesce(recovery_token, ''),
    email_change               = coalesce(email_change, ''),
    email_change_token_new     = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change               = coalesce(phone_change, ''),
    phone_change_token         = coalesce(phone_change_token, ''),
    reauthentication_token     = coalesce(reauthentication_token, '')
  where email like '%@local.test';
end $$;

-- Que no quede colgada en la sesión.
select set_config('seed.clave', '', false);

select u.email, m.rol, m.taller_etapas, e.nombre_fantasia
  from auth.users u
  join membresia m on m.usuario_id = u.id
  join empresa e   on e.id = m.empresa_id
 where u.email like '%@local.test'
 order by e.nombre_fantasia, u.email;
