-- Datos controlados para probar SAU IA, SOLO en TALLER SAN MARTÍN.
--
-- La empresa de prueba está llena de "AUTO REPETIDO" y "PARA BORRAR" de
-- corridas anteriores: sirve para probar permisos, no para probar respuestas.
-- Para comprobar que el chat contesta bien hacen falta datos que uno pueda
-- verificar a mano contra la base: modelos reales, productores, compañías y
-- fechas repartidas.
--
-- Todos con patente ZZIA%, que es lo que borra la limpieza de abajo y el seed
-- general. Ninguna línea toca otra empresa.

do $$
declare
  v_a uuid := '11111111-aaaa-4aaa-8aaa-111111111111';  -- TALLER SAN MARTÍN
begin
  -- Idempotente: se rehace la tanda entera en cada corrida.
  delete from vehiculo where empresa_id = v_a and patente like 'ZZIA%';

  insert into vehiculo (empresa_id, patente, vehiculo, cliente_nombre, compania,
                        productor, fecha_ingreso, fecha_pactada, etapa, fecha_entrega)
  values
    -- Tres Amarok, repartidas en el tiempo: una vieja (fuera de 6 meses) y dos adentro.
    (v_a, 'ZZIA001', 'Volkswagen Amarok V6', 'Cliente Amarok Uno',  'Zurich',
          'Pérez Seguros',   current_date - 400, current_date - 380, 'entregado', current_date - 370),
    (v_a, 'ZZIA002', 'Volkswagen Amarok Comfortline', 'Cliente Amarok Dos', 'Mapfre',
          'Pérez Seguros',   current_date - 100, current_date - 70,  'entregado', current_date - 75),
    (v_a, 'ZZIA003', 'Volkswagen Amarok Highline', 'Cliente Amarok Tres', 'Zurich',
          'Gómez Broker',    current_date - 40,  current_date - 5,   'pintura',   null),
    -- Dos Hilux adentro de los últimos 6 meses.
    (v_a, 'ZZIA004', 'Toyota Hilux SRV', 'Cliente Hilux Uno', 'Sancor',
          'Gómez Broker',    current_date - 150, current_date - 120, 'entregado', current_date - 118),
    (v_a, 'ZZIA005', 'Toyota Hilux SR',  'Cliente Hilux Dos', 'Zurich',
          'Pérez Seguros',   current_date - 20,  current_date + 10,  'chapa',     null),
    -- Otros modelos, para que los rankings no sean triviales.
    (v_a, 'ZZIA006', 'Ford Ranger XLT', 'Cliente Ranger', 'Federación Patronal',
          'Gómez Broker',    current_date - 60,  current_date - 30,  'terminacion', null),
    (v_a, 'ZZIA007', 'Fiat Toro Volcano', 'Cliente Toro', 'Mapfre',
          'Pérez Seguros',   current_date - 10,  current_date + 20,  'recepcion', null),
    (v_a, 'ZZIA008', 'Chevrolet S10 LTZ', 'Cliente S10', 'Zurich',
          null,              current_date - 5,   current_date + 25,  'recepcion', null),
    -- Uno viejo y uno muy demorado, para "cuáles tardaron más".
    (v_a, 'ZZIA009', 'Renault Duster Oroch', 'Cliente Duster', 'San Cristóbal',
          'Gómez Broker',    current_date - 300, current_date - 250, 'entregado', current_date - 120),
    (v_a, 'ZZIA010', 'Peugeot 208 Allure', 'Cliente 208', 'Particular',
          null,              current_date - 200, current_date - 170, 'preparacion', null);

  -- Un detenido con motivo, para las preguntas sobre excepciones.
  -- La guardia de flujo frena este UPDATE igual que a cualquier otro, así que
  -- hay que poner la bandera de sesión que usan las funciones del taller. Que
  -- haga falta es la prueba de que la guardia funciona.
  perform set_config('taller.flujo', 'on', true);
  update vehiculo
     set excepcion = 'detenido', excepcion_desde = now()
   where empresa_id = v_a and patente = 'ZZIA010';
  perform set_config('taller.flujo', '', true);

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  select id, 'nota', etapa, 'Esperando que la compañía autorice el repuesto del paragolpes.'
    from vehiculo where empresa_id = v_a and patente = 'ZZIA010';

  insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
  select id, 'nota', etapa, 'El cliente pidió sumar el pulido del capó.'
    from vehiculo where empresa_id = v_a and patente = 'ZZIA003';
end $$;

select patente, vehiculo, compania, productor, fecha_ingreso, etapa
  from vehiculo
 where empresa_id = '11111111-aaaa-4aaa-8aaa-111111111111'
   and patente like 'ZZIA%'
 order by patente;
