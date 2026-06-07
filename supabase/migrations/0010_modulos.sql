-- Agrega el campo modulos_activos a empresa.
-- Es un array de texto con los IDs de módulos habilitados.
-- Default: todos activos para no romper empresas existentes.
alter table empresa
  add column if not exists modulos_activos text[]
  default array['ventas','caja','compras','equipo'];

-- Aseguramos que las empresas ya existentes queden con todo activo
update empresa
  set modulos_activos = array['ventas','caja','compras','equipo']
  where modulos_activos is null;
