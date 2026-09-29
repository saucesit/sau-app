-- Archivo de entregados para probar la pantalla de consulta.
--
-- Solo toca ZZ PRUEBA TALLER A. No mira ni escribe TALLER FORANI.
-- Es idempotente: borra sus propias patentes (ZZENT*) y las vuelve a crear.

do $$
declare
  v_a   uuid := '11111111-aaaa-4aaa-8aaa-111111111111';
  v_id  uuid;
  r     record;
begin
  -- La pizarra de control es lo que estamos probando; la empresa de prueba
  -- tiene que verla igual que Forani.
  update empresa set tema_taller = 'control_board' where id = v_a;

  delete from vehiculo where empresa_id = v_a and patente like 'ZZENT%';

  for r in
    select * from (values
      ('ZZENT01', 'Toyota Hilux SRX',      'Cáceres Tomás',      '387 415-2201', 'Sancor',
       '80109981234', date '2024-03-04', date '2024-04-18',  2180000,  150000,       0, true,  true,  false),
      ('ZZENT02', 'Chevrolet Onix LTZ',    'Marisa Coronel',     '387 622-1190', 'Zurich',
       '77120034488', date '2025-08-11', date '2025-09-10',  2140000,       0,       0, true,  false, false),
      ('ZZENT03', 'Ford Ranger XLT',       'Roberto Díaz',       NULL,           'Mapfre',
       '55023119876', date '2026-01-22', date '2026-02-02',  3980500,  220000,       0, false, false, false),
      ('ZZENT04', 'Citroen C3 Aircross',   'Abel Nallar',        '387 501-7744', 'Particular',
       NULL,          date '2026-08-19', date '2026-09-15',        0,       0,  630000, false, false, true),
      ('ZZENT05', 'VW Amarok Highline',    'Cardoner SRL',       '387 400-9080', 'Federación Patronal',
       '90881277311', date '2026-07-02', date '2026-09-01',  4310000,  180000,       0, false, false, false),
      ('ZZENT06', 'Renault Alaskan',       'Agroservicios Norte','387 733-2255', 'San Cristóbal',
       '61200455190', date '2026-06-14', date '2026-07-29',  2890000,       0,  145000, true,  false, false)
    ) as t(patente, vehiculo, cliente, telefono, compania, siniestro,
           ingreso, entrega, m_cia, m_fra, m_par, c_cia, c_fra, c_par)
  loop
    insert into vehiculo (
      empresa_id, patente, vehiculo, cliente_nombre, telefono, compania,
      nro_siniestro, fecha_ingreso, fecha_pactada, fecha_entrega, etapa, panos, kilometraje
    ) values (
      v_a, r.patente, r.vehiculo, r.cliente, r.telefono, r.compania,
      r.siniestro, r.ingreso, r.entrega, r.entrega, 'entregado',
      2 + (random() * 4)::int, 40000 + (random() * 90000)::int
    ) returning id into v_id;

    -- Los montos los crea en cero el trigger de alta; acá se completan.
    update vehiculo_monto
       set monto_compania = r.m_cia, monto_franquicia = r.m_fra, monto_particular = r.m_par
     where vehiculo_id = v_id;

    -- Las validaciones de cobro solo se mueven con la bandera del flujo puesta.
    perform set_config('taller.flujo', 'on', true);
    update vehiculo_monto
       set cobro_compania = r.c_cia, cobro_franquicia = r.c_fra, cobro_particular = r.c_par
     where vehiculo_id = v_id;
    perform set_config('taller.flujo', '', true);

    insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto) values
      (v_id, 'nota',     'chapa',     'Se pidió repuesto a la concesionaria.'),
      (v_id, 'entrega',  'entregado', 'Vehículo entregado al cliente.');
  end loop;
end $$;

select patente, cliente_nombre, telefono, compania, fecha_entrega
  from vehiculo
 where empresa_id = '11111111-aaaa-4aaa-8aaa-111111111111'
   and etapa = 'entregado'
 order by fecha_entrega desc;
