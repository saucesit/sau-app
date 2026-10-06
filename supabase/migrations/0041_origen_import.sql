-- De dónde salió cada vehículo importado.
--
-- NO APLICADA TODAVÍA. Va junto con la importación del Excel de Forani.
--
-- Guarda la hoja y la fila del Excel de las que salió cada vehículo. Sirve para
-- dos cosas:
--
--   1. Que la importación se pueda correr dos veces sin duplicar nada. El
--      índice único es el que lo garantiza, no el cuidado de quien la corre.
--   2. Poder volver al origen cuando algo no cuadre: "este vehículo salió de
--      la fila 143 de la hoja ENTREGADOS".
--
-- Queda en null para todo lo cargado a mano, que es la mayoría de lo que hay.

alter table vehiculo
  add column if not exists origen_import text;

comment on column vehiculo.origen_import is
  'Hoja y fila del Excel del que se importó, por ejemplo TALLER:12. Null si se cargó a mano.';

-- Único por empresa, y solo entre los que tienen origen: dos empresas podrían
-- importar su propia fila 12 sin pisarse.
create unique index if not exists idx_vehiculo_origen_import
  on vehiculo (empresa_id, origen_import)
  where origen_import is not null;
