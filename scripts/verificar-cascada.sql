-- Qué se lleva puesto eliminar un vehículo.
--
-- Comprobado empíricamente el 30/09/2026 con una cuenta de cliente: la cascada
-- borró montos, bitácora y registros de adjuntos, y el archivo quedó huérfano
-- en el bucket. Desde 0038 eliminar es exclusivo de SAU, así que esa prueba por
-- API ya no se puede hacer con cuentas ficticias. Queda esta verificación
-- estructural, que es la que importa para el día que se decida cambiarlo.
--
--   supabase db query --linked -f scripts/verificar-cascada.sql

select c.relname as tabla, con.conname,
       case con.confdeltype when 'c' then 'CASCADE — se borra con el vehículo'
                            when 'n' then 'SET NULL' when 'a' then 'NO ACTION'
                            else con.confdeltype::text end as al_borrar_el_vehiculo
  from pg_constraint con
  join pg_class c  on c.oid = con.conrelid
  join pg_class rc on rc.oid = con.confrelid
 where con.contype = 'f' and rc.relname = 'vehiculo'
 order by c.relname;
