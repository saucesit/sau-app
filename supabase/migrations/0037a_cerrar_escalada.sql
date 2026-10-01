-- URGENTE — Cierra la escalada de privilegios, y nada más.
--
-- Es la primera mitad de 0037, separada para poder aplicarla sola. No cambia
-- quién tiene acceso a qué: solo impide que alguien SE DÉ acceso.
--
-- El problema, comprobado el 01/10/2026: `es_contadora_o_admin()` —de la que
-- cuelgan 21 policies— devuelve verdadero si `profile.es_sau_admin` está en
-- true. Y cualquier usuario logueado podía ponérselo con una sola llamada,
-- porque la policy `profile_update_self` deja actualizar la fila propia y el
-- rol `authenticated` tenía UPDATE sobre esa columna.
--
-- Resultado: de una llamada, acceso de lectura a todas las empresas de SAU.
-- Verificado con una cuenta de prueba, que pasó de ver 1 empresa a ver las 8.
-- Revertida en el acto.
--
-- Aplicar esto NO le saca nada a nadie: hoy el único perfil con es_sau_admin
-- es el de Facundo, y lo conserva.

-- Primera barrera: los permisos de columna.
--
-- OJO con esto, que me lo comí en el primer intento: `authenticated` tiene el
-- permiso a NIVEL TABLA, y un revoke por columna sobre un permiso de tabla no
-- hace nada. Hay que sacar el de tabla y devolver solo las columnas inocuas.
--
-- Se puede hacer sin romper nada porque ningún punto de la aplicación escribe
-- `profile` desde el navegador: solo lee. Las altas y los cambios de nombre los
-- hacen las edge functions con service_role, que no pasa por estos permisos.
-- Las tres columnas se devuelven igual, para que editar el propio perfil siga
-- siendo posible el día que haya una pantalla que lo haga.

revoke update, insert on profile from authenticated;
revoke update, insert on profile from anon;

grant update (nombre, apellido, telefono) on profile to authenticated;
grant insert (id, nombre, apellido, telefono) on profile to authenticated;

-- Segunda barrera, independiente de los permisos de columna. Incluye a
-- service_role a propósito: las edge functions administran equipos de empresa y
-- ninguna tiene por qué tocar esto. Solo pasa con la bandera puesta a mano.
create or replace function sau_guardia_admin_global()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('sau.admin_global', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if coalesce(new.es_sau_admin, false) or coalesce(new.es_sau_contadora, false) then
        raise exception 'El administrador global de SAU no se asigna al crear un perfil';
      end if;
    else
      if new.es_sau_admin     is distinct from old.es_sau_admin
      or new.es_sau_contadora is distinct from old.es_sau_contadora then
        raise exception 'El administrador global de SAU no se cambia desde la aplicación';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sau_guardia_admin_global on profile;
create trigger trg_sau_guardia_admin_global
  before insert or update on profile
  for each row execute function sau_guardia_admin_global();

-- Para asignarlo de verdad, a mano y a conciencia:
--   select set_config('sau.admin_global','on',true);
--   update profile set es_sau_admin = true where id = '...';
