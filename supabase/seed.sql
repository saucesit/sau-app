-- Datos ficticios para el entorno local.
--
-- Lo corre solo `supabase db reset` / `supabase start` sobre la base local.
-- NUNCA contra producción.
--
-- Todo lo de acá es inventado: nombres, patentes, compañías y montos. No sale
-- de ningún cliente real ni contiene credenciales. Los usuarios y sus
-- contraseñas van aparte, en scripts/seed-usuarios-locales.sql, justamente para
-- que ninguna contraseña quede versionada.
--
-- Las fechas son relativas a hoy, así el tablero siempre se ve vivo: hay autos
-- en plazo, otros por vencer y otros con demora crítica, sin tener que tocar
-- nada.

do $$
declare
  v_taller   uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_comercio uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
  v_id       uuid;
  v_etapa    text;
  r          record;
begin

  -- ── Empresas ────────────────────────────────────────────────────
  insert into empresa (id, razon_social, nombre_fantasia, cuit, condicion_fiscal,
                       actividad, domicilio_fiscal, modulos_activos, tema_taller)
  values
    (v_taller, 'CHAPERIA DEL VALLE SRL', 'Chapería del Valle', '30-99999901-7',
     'responsable_inscripto', 'Chapa y pintura', 'Av. Inventada 1200, Salta',
     array['taller'], 'control_board'),
    (v_comercio, 'ALMACEN LA ESQUINA', 'La Esquina', '27-99999902-3',
     'monotributo', 'Almacén', 'Calle Falsa 742, Salta',
     array['ventas','caja','fiado','stock'], 'clasico')
  on conflict (id) do update
    set modulos_activos = excluded.modulos_activos,
        tema_taller     = excluded.tema_taller;

  -- ── Taller: vehículos en las seis etapas ────────────────────────
  -- dias_ingreso y dias_etapa son hacia atrás desde hoy.
  delete from vehiculo where empresa_id = v_taller;

  for r in
    select * from (values
      -- patente, vehículo, cliente, teléfono, compañía, siniestro, etapa,
      -- dias_ingreso, dias_etapa, dias_pactada (negativo = ya venció),
      -- excepcion, trabajo_hecho, panos, km, m_cia, m_fra, m_par
      ('AD412TR','VW Gol Trend','Marcela Quiroga','387 555-0101','Zurich',
       '70110022001','recepcion',    2,  2,  18, null,        false, 2,  74000,  890000,  120000,      0),
      ('AE770LM','Fiat Cronos','Hernán Villalba','387 555-0102','Sancor',
       '70110022002','recepcion',    6,  1,  12, null,        false, 3,  51000, 1240000,       0,      0),
      ('AB255QQ','Toyota Hilux SRV','Transporte Andino SRL','387 555-0103','Mapfre',
       '70110022003','chapa',       38, 11,  -6, 'mecanica',  false, 6, 132000, 3980000,  210000,      0),
      ('AC901WZ','Ford Ranger XL','Estudio Contable Paz','387 555-0104','San Cristóbal',
       '70110022004','chapa',       14,  5,   4, null,        true,  4,  88000, 2150000,       0,      0),
      ('AF338KD','Renault Duster','Silvina Robles','387 555-0105','Federación Patronal',
       '70110022005','chapa',       25,  9,  -2, 'ampliacion',false, 5,  63000, 1760000,  150000,      0),
      ('AG104BN','Peugeot 208','Lucas Ferreyra','387 555-0106','Particular',
       null,         'preparacion', 10,  3,   9, null,        false, 2,  29000,       0,       0, 740000),
      ('AH562PV','Chevrolet S10','Agro del Norte SA','387 555-0107','Zurich',
       '70110022006','pintura',     31,  8,  -4, null,        false, 7, 110000, 4420000,  260000,      0),
      ('AI087RC','VW Amarok','Nicolás Paredes','387 555-0108','Sancor',
       '70110022007','pintura',     13,  2,   6, null,        true,  3,  95000, 2030000,       0,      0),
      ('AJ640SX','Fiat Toro','Constructora Sur SRL','387 555-0109','Mapfre',
       '70110022008','terminacion', 19,  2,   3, null,        false, 4, 102000, 2680000,  180000,      0),
      ('AK223TY','Citroen C3','Paula Mendieta','387 555-0110','Particular',
       null,         'control_calidad',   16,  4,   1, null,        false, 2,  41000,       0,       0, 615000),
      ('AL919UZ','Nissan Frontier','Minera Ficticia SA','387 555-0111','San Cristóbal',
       '70110022009','control_calidad',   27,  6,  -1, null,        false, 5, 156000, 3310000,  240000,      0),
      ('AM474VD','Renault Kangoo','Distribuidora Ríos','387 555-0112','Zurich',
       '70110022010','detenido_ej', 21,  7,   2, 'detenido',  false, 3,  71000, 1480000,       0,      0)
    ) as t(patente, vehiculo, cliente, telefono, compania, siniestro, etapa,
           dias_ingreso, dias_etapa, dias_pactada, excepcion, trabajo_hecho,
           panos, km, m_cia, m_fra, m_par)
  loop
    -- "detenido_ej" es solo una marca de la tabla de arriba: la etapa real es
    -- preparación, y lo que lo frena es la excepción.
    v_etapa := case when r.etapa = 'detenido_ej' then 'preparacion' else r.etapa end;

    insert into vehiculo (
      empresa_id, patente, vehiculo, cliente_nombre, telefono, compania,
      nro_siniestro, fecha_ingreso, fecha_pactada, etapa, etapa_desde,
      excepcion, excepcion_desde, trabajo_hecho, panos, kilometraje
    ) values (
      v_taller, r.patente, r.vehiculo, r.cliente, r.telefono, r.compania,
      r.siniestro,
      current_date - r.dias_ingreso,
      current_date + r.dias_pactada,
      v_etapa,
      now() - (r.dias_etapa || ' days')::interval,
      r.excepcion,
      case when r.excepcion is null then null else now() - interval '3 days' end,
      r.trabajo_hecho, r.panos, r.km
    ) returning id into v_id;

    update vehiculo_monto
       set monto_compania = r.m_cia, monto_franquicia = r.m_fra, monto_particular = r.m_par
     where vehiculo_id = v_id;

    if r.excepcion is not null then
      insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto) values
        (v_id, 'excepcion', v_etapa,
         case r.excepcion
           when 'mecanica'   then 'Derivado a mecánica por el tren delantero.'
           when 'ampliacion' then 'Se pidió ampliación a la compañía por daño oculto.'
           else 'Detenido: el cliente todavía no autorizó el trabajo.'
         end);
    end if;
    if r.trabajo_hecho then
      insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)
      values (v_id, 'trabajo_hecho', v_etapa, 'Trabajo marcado como realizado');
    end if;
  end loop;

  -- ── Taller: archivo de entregados, repartido en tres años ───────
  for r in
    select * from (values
      ('ZX118AA','Chevrolet Onix','Rosa Giménez','387 555-0201','Zurich',
       '70009988001', 780, 742, 1980000,       0,      0, true,  false, false),
      ('ZX229BB','Ford EcoSport','Martín Sosa','387 555-0202','Mapfre',
       '70009988002', 640, 598, 2240000,  190000,      0, true,  true,  false),
      ('ZX330CC','Toyota Etios','Carla Bustos',null,'Particular',
       null,          410, 389,       0,       0, 560000, false, false, true),
      ('ZX441DD','VW Saveiro','Logística Ficticia SRL','387 555-0203','Sancor',
       '70009988003', 300, 256, 3110000,  220000,      0, true,  false, false),
      ('ZX552EE','Renault Sandero','Diego Almada','387 555-0204','San Cristóbal',
       '70009988004', 150, 118, 1690000,       0,      0, false, false, false),
      ('ZX663FF','Fiat Argo','Verónica Luna','387 555-0205','Federación Patronal',
       '70009988005',  60,  33, 2480000,  160000,      0, true,  true,  false)
    ) as t(patente, vehiculo, cliente, telefono, compania, siniestro,
           dias_ingreso, dias_entrega, m_cia, m_fra, m_par, c_cia, c_fra, c_par)
  loop
    insert into vehiculo (
      empresa_id, patente, vehiculo, cliente_nombre, telefono, compania,
      nro_siniestro, fecha_ingreso, fecha_pactada, fecha_entrega, etapa,
      etapa_desde, panos, kilometraje
    ) values (
      v_taller, r.patente, r.vehiculo, r.cliente, r.telefono, r.compania,
      r.siniestro,
      current_date - r.dias_ingreso,
      current_date - r.dias_entrega,
      current_date - r.dias_entrega,
      'entregado',
      now() - (r.dias_entrega || ' days')::interval,
      2 + (random() * 4)::int, 40000 + (random() * 90000)::int
    ) returning id into v_id;

    update vehiculo_monto
       set monto_compania = r.m_cia, monto_franquicia = r.m_fra, monto_particular = r.m_par
     where vehiculo_id = v_id;

    -- Los tildes de cobro tienen guardia: solo se mueven con la bandera puesta.
    perform set_config('taller.flujo', 'on', true);
    update vehiculo_monto
       set cobro_compania = r.c_cia, cobro_franquicia = r.c_fra, cobro_particular = r.c_par
     where vehiculo_id = v_id;
    perform set_config('taller.flujo', '', true);

    insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto) values
      (v_id, 'nota',    'chapa',     'Se esperó repuesto de la concesionaria.'),
      (v_id, 'avance',  'pintura',   'Validado y pasa a Pre Entrega.'),
      (v_id, 'entrega', 'entregado', 'Vehículo entregado al cliente.');
  end loop;

  -- ── Comercio: catálogo mínimo para que Ventas y Stock no estén vacíos ──
  delete from producto where empresa_id = v_comercio;
  insert into producto (empresa_id, nombre, precio_costo, precio_venta, stock_actual, stock_minimo)
  values
    (v_comercio, 'Yerba 1 kg',         3100, 4200, 24,  6),
    (v_comercio, 'Aceite girasol 1 L', 2300, 3100, 15,  5),
    (v_comercio, 'Fideos 500 g',       1000, 1450, 60, 12),
    (v_comercio, 'Azúcar 1 kg',        1500, 2050,  4,  8),
    (v_comercio, 'Gaseosa 2,25 L',     2800, 3800, 31,  8);

end $$;

select
  (select count(*) from empresa  where id::text like 'aaaaaaaa-0000%')                   as empresas,
  (select count(*) from vehiculo where empresa_id = 'aaaaaaaa-0000-4000-8000-000000000001'
     and etapa <> 'entregado')                                                           as en_taller,
  (select count(*) from vehiculo where empresa_id = 'aaaaaaaa-0000-4000-8000-000000000001'
     and etapa =  'entregado')                                                           as entregados,
  (select count(*) from producto where empresa_id = 'aaaaaaaa-0000-4000-8000-000000000002')
                                                                                         as productos;
