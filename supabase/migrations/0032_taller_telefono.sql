-- Teléfono del cliente en la ficha del vehículo.
--
-- Pedido de Forani sobre la demo: cuando hay que avisar que el auto está listo,
-- o consultar algo del trabajo, hoy el teléfono está en un cuaderno aparte.
--
-- Va en `vehiculo` y no en una tabla de clientes porque el taller no lleva
-- padrón de clientes: cada ingreso es un caso, y el mismo auto puede volver
-- dentro de dos años con otro titular. Es el dato de contacto DE ESE ingreso.
--
-- No es obligatorio: hay ingresos de flota y de compañía donde el contacto es
-- el productor y nadie tiene el teléfono del titular a mano.

alter table vehiculo
  add column if not exists telefono text;

comment on column vehiculo.telefono is
  'Teléfono de contacto del cliente para este ingreso. Opcional.';
