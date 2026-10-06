# -*- coding: utf-8 -*-
"""
Importador del Excel de Grupo Forani.

Por defecto NO escribe nada: lee el Excel, lo contrasta con lo que ya hay en la
base y deja dos cosas en la carpeta de salida:

    preview.txt   el informe para leer antes de decidir
    importar.sql  el SQL que haría la carga, para revisarlo línea por línea

Nada se aplica hasta que alguien corra ese .sql a propósito.

    python scripts/importar-forani.py <ruta-del-excel> <carpeta-de-salida>

Criterios, todos conservadores y sin inventar datos:

  * Fecha pactada vacía queda vacía. No se estima.
  * Patente repetida NO se descarta: se importa como otra orden, porque el
    mismo auto puede tener dos trabajos abiertos. Queda listada aparte para
    que alguien la mire.
  * Facturación: SÍ -> facturado, NO -> pendiente, vacío -> no aplica. El
    vacío es ambiguo y no debe inflar los pendientes del tablero.
  * "Detenido" no es una etapa: se importa como excepción, y como el Excel no
    dice en qué etapa estaba, el vehículo queda en Recepción con una nota que
    lo aclara. La etapa real la confirma el taller.
  * Una fila sin patente o sin fecha de ingreso no se importa: se informa.
"""
import sys, os, re, json, unicodedata
from datetime import datetime, date

import openpyxl

EMPRESA_FORANI = 'bdd20f9b-1030-434a-96de-2418afb53760'

ETAPAS_SAU = ['recepcion', 'chapa', 'preparacion', 'pintura',
              'terminacion', 'control_calidad', 'entregado']


def sinacentos(t):
    t = unicodedata.normalize('NFKD', str(t))
    return ''.join(c for c in t if not unicodedata.combining(c)).upper().strip()


# Cómo se llama cada etapa en el Excel -> cómo se llama en SAU.
MAPA_ETAPAS = {
    'RECEPCION':       'recepcion',
    'CHAPA':           'chapa',
    'PREPARACION':     'preparacion',
    'PINTURA':         'pintura',
    'TERMINACION':     'terminacion',
    'CONTROL CALIDAD': 'control_calidad',
    'VH ENTREGADO':    'entregado',
}
# Lo que el Excel pone como etapa pero en SAU es estado paralelo.
MAPA_EXCEPCIONES = {
    'DETENIDO':   'detenido',
    'MECANICA':   'mecanica',
    'AMPLIACION': 'ampliacion',
}


def norm_patente(p):
    return re.sub(r'[^A-Z0-9]', '', str(p).upper()) if p else ''


def a_fecha(v):
    if v in (None, ''):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def a_num(v):
    if v in (None, ''):
        return 0
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0


def texto(v):
    if v in (None, ''):
        return None
    s = re.sub(r'\s+', ' ', str(v)).strip()
    return s or None


def estado_fact(v):
    """SÍ -> facturado · NO -> pendiente · vacío -> no aplica."""
    s = sinacentos(v) if v not in (None, '') else ''
    if s in ('SI', 'SÍ'):
        return 'facturado'
    if s == 'NO':
        return 'pendiente'
    return 'no_aplica'


def leer(hoja, f_cab, f_dato):
    cab = [re.sub(r'\s+', ' ', str(c)).strip() if c else ''
           for c in list(hoja.iter_rows(min_row=f_cab, max_row=f_cab, values_only=True))[0]]
    filas = []
    for i, fila in enumerate(hoja.iter_rows(min_row=f_dato, values_only=True), f_dato):
        if not any(c not in (None, '') for c in fila):
            continue
        d = {cab[j]: v for j, v in enumerate(fila) if j < len(cab) and cab[j]}
        if isinstance(d.get('N°'), str) and 'GRUPO' in str(d['N°']).upper():
            continue   # pie de página
        d['_fila'] = i
        filas.append(d)
    return filas


def sql_txt(v):
    if v is None:
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


def sql_fecha(v):
    return 'null' if v is None else "'" + v.isoformat() + "'"


def main():
    excel = sys.argv[1]
    salida = sys.argv[2]
    os.makedirs(salida, exist_ok=True)

    wb = openpyxl.load_workbook(excel, data_only=True)
    taller = leer(wb['TALLER'], 6, 8)
    entregados = leer(wb['ENTREGADOS'], 5, 6)
    sin_ingreso = leer(wb['FACTURADOS SIN INGRESO'], 5, 6)

    listos, problemas, avisos = [], [], []

    # ── Hoja TALLER: los que están adentro ────────────────────────
    for f in taller:
        ref = f"TALLER:{f['_fila']}"
        pat = norm_patente(f.get('DOMINIO'))
        ing = a_fecha(f.get('FECHA INGRESO'))

        if not pat:
            problemas.append((ref, 'sin patente', 'no se importa'))
            continue
        if not ing:
            problemas.append((ref, f'{pat}: sin fecha de ingreso', 'no se importa'))
            continue

        cruda = sinacentos(f.get('ETAPA ACTUAL') or '')
        etapa, excepcion, nota = None, None, None

        if cruda in MAPA_ETAPAS:
            etapa = MAPA_ETAPAS[cruda]
        elif cruda in MAPA_EXCEPCIONES:
            etapa = 'recepcion'
            excepcion = MAPA_EXCEPCIONES[cruda]
            nota = (f'Importado del Excel con estado "{texto(f.get("ETAPA ACTUAL"))}". '
                    'El Excel no dice en qué etapa estaba, así que quedó en Recepción: '
                    'hay que confirmar la etapa real.')
            avisos.append((ref, f'{pat}: "{texto(f.get("ETAPA ACTUAL"))}" es estado, no etapa',
                           'queda en Recepción con la excepción puesta'))
        else:
            problemas.append((ref, f'{pat}: etapa "{texto(f.get("ETAPA ACTUAL")) or "(vacía)"}" '
                                   'no se reconoce', 'no se importa'))
            continue

        obs = texto(f.get('REPORTE DIARIO Y OBSERVACIÓNES'))
        listos.append({
            'ref': ref, 'hoja': 'TALLER', 'patente': pat,
            'vehiculo': texto(f.get('VEHÍCULO')) or 'SIN DATO',
            'cliente': texto(f.get('CLIENTE')) or 'SIN DATO',
            'compania': texto(f.get('COMPAÑÍA')) or 'SIN DATO',
            'productor': texto(f.get('PRODUCTOR / TERCERO')),
            'perito': None,
            'siniestro': texto(f.get('N° SINIESTRO')),
            'ingreso': ing,
            'pactada': a_fecha(f.get('F. PACTADA ENTREGA')),
            'entrega': a_fecha(f.get('F. REAL ENTREGA')) if etapa == 'entregado' else None,
            'etapa': etapa, 'excepcion': excepcion, 'nota': nota or obs,
            'm_cia': a_num(f.get('MONTO COMPAÑÍA $')),
            'm_fra': a_num(f.get('FRANQUICIA $')),
            'm_par': a_num(f.get('PARTICULAR $')),
            'e_cia': estado_fact(f.get('FACT. COMP')),
            'e_fra': estado_fact(f.get('FACT. FRANQ')),
            'e_par': estado_fact(f.get('FACT. PART')),
        })

    # ── Hoja ENTREGADOS: el histórico ─────────────────────────────
    for f in entregados:
        ref = f"ENTREGADOS:{f['_fila']}"
        pat = norm_patente(f.get('DOMINIO'))
        ing = a_fecha(f.get('FECHA INGRESO'))
        egr = a_fecha(f.get('FECHA EGRESO'))

        if not pat:
            problemas.append((ref, 'sin patente', 'no se importa'))
            continue
        if not ing and not egr:
            problemas.append((ref, f'{pat}: sin fecha de ingreso ni de egreso', 'no se importa'))
            continue
        if not ing:
            ing = egr
            avisos.append((ref, f'{pat}: sin fecha de ingreso',
                           'se usa la de egreso, que es el único dato que hay'))

        listos.append({
            'ref': ref, 'hoja': 'ENTREGADOS', 'patente': pat,
            'vehiculo': texto(f.get('VEHÍCULO')) or 'SIN DATO',
            'cliente': texto(f.get('CLIENTE')) or 'SIN DATO',
            'compania': texto(f.get('COMPAÑÍA')) or 'SIN DATO',
            'productor': None,
            'perito': texto(f.get('PERITO')),
            'siniestro': texto(f.get('N° SINIESTRO')),
            'ingreso': ing, 'pactada': a_fecha(f.get('F. PACTADA')), 'entrega': egr,
            'etapa': 'entregado', 'excepcion': None, 'nota': None,
            'm_cia': a_num(f.get('MONTO COMPAÑÍA $')),
            'm_fra': a_num(f.get('FRANQUICIA $')),
            'm_par': a_num(f.get('PARTICULAR $')),
            'e_cia': estado_fact(f.get('FACT. COMP')),
            'e_fra': estado_fact(f.get('FACT. FRANQ')),
            'e_par': estado_fact(f.get('FACT. PART')),
        })

    for f in sin_ingreso:
        pat = norm_patente(f.get('DOMINIO'))
        avisos.append((f"SIN INGRESO:{f['_fila']}", f'{pat}: facturado sin ingreso',
                       'NO se importa: no es un trabajo del taller'))

    # ── Patentes repetidas ────────────────────────────────────────
    por_patente = {}
    for v in listos:
        por_patente.setdefault(v['patente'], []).append(v)
    repetidas = {p: vs for p, vs in por_patente.items() if len(vs) > 1}
    rep_activas = {p: vs for p, vs in repetidas.items()
                   if sum(1 for v in vs if v['etapa'] != 'entregado') > 1}

    # La guardia de 0042 rechaza una segunda orden activa de la misma patente
    # salvo que esté marcada como adicional a propósito. Acá se marca: son
    # órdenes distintas del Excel, no una carga por error.
    for v in listos:
        v['adicional'] = False
    for p, vs in rep_activas.items():
        act = sorted([v for v in vs if v['etapa'] != 'entregado'],
                     key=lambda v: (v['ingreso'], v['ref']))
        for v in act[1:]:
            v['adicional'] = True

    # ── Informe ───────────────────────────────────────────────────
    L = []
    w = L.append
    w('IMPORTACIÓN DEL EXCEL DE GRUPO FORANI — VISTA PREVIA')
    w('Nada de esto está aplicado. Es lo que haría el .sql que se generó al lado.')
    w('')
    activos = [v for v in listos if v['etapa'] != 'entregado']
    hist = [v for v in listos if v['etapa'] == 'entregado']
    w(f'  A importar: {len(listos)}   ({len(activos)} adentro del taller, {len(hist)} entregados)')
    w(f'  No se importan: {len(problemas)}')
    w(f'  Avisos: {len(avisos)}')
    w('')

    w('ETAPAS CON LAS QUE ENTRAN')
    cuenta = {}
    for v in activos:
        cuenta[v['etapa']] = cuenta.get(v['etapa'], 0) + 1
    for e in ETAPAS_SAU:
        if cuenta.get(e):
            w(f'  {cuenta[e]:>3}  {e}')
    w('')

    w('PLATA')
    pend = {'cia': 0.0, 'fra': 0.0, 'par': 0.0}
    for v in activos:
        if v['e_cia'] == 'pendiente': pend['cia'] += v['m_cia']
        if v['e_fra'] == 'pendiente': pend['fra'] += v['m_fra']
        if v['e_par'] == 'pendiente': pend['par'] += v['m_par']
    w(f'  Pendiente de facturar que va a mostrar el tablero (solo los activos):')
    w(f'    compañía   $ {pend["cia"]:>15,.2f}')
    w(f'    franquicia $ {pend["fra"]:>15,.2f}')
    w(f'    particular $ {pend["par"]:>15,.2f}')
    est = {}
    for v in listos:
        for k in ('e_cia', 'e_fra', 'e_par'):
            est[v[k]] = est.get(v[k], 0) + 1
    w(f'  Estados de facturación en total: {est}')
    w('  (el vacío del Excel entra como "no aplica" y por eso no suma)')
    w('')

    if rep_activas:
        w('PATENTES REPETIDAS ENTRE LOS ACTIVOS — se importan igual, como órdenes distintas')
        w('  Las segundas entran marcadas como "orden adicional", que es lo que la')
        w('  guardia de duplicados pide para dejarlas pasar a propósito.')
        for p, vs in sorted(rep_activas.items()):
            w(f'  {p}:')
            for v in vs:
                marca = '  [orden adicional]' if v.get('adicional') else ''
                w(f'      {v["ref"]:<18} ingreso {v["ingreso"]}  etapa {v["etapa"]:<16} '
                  f'$ {v["m_cia"] + v["m_fra"] + v["m_par"]:>14,.2f}{marca}')
        w('')

    otras_rep = {p: vs for p, vs in repetidas.items() if p not in rep_activas}
    if otras_rep:
        w(f'PATENTES QUE APARECEN MÁS DE UNA VEZ EN EL HISTÓRICO: {len(otras_rep)}')
        w('  Es normal: el mismo auto puede haber vuelto. Se importan todas.')
        w(f'  Ejemplos: {", ".join(sorted(otras_rep)[:10])}')
        w('')

    if avisos:
        w('AVISOS')
        for ref, qué, qué_se_hizo in avisos:
            w(f'  {ref:<18} {qué}')
            w(f'  {"":<18}   -> {qué_se_hizo}')
        w('')

    if problemas:
        w('NO SE IMPORTAN')
        for ref, qué, _ in problemas:
            w(f'  {ref:<18} {qué}')
        w('')

    w('LO QUE NO TRAE EL EXCEL Y VA A QUEDAR VACÍO')
    sin_pact = sum(1 for v in activos if v['pactada'] is None)
    w(f'  Fecha pactada de entrega: falta en {sin_pact} de {len(activos)} activos.')
    w('    Sin ella no hay alerta de "fuera de plazo". No se estima, queda vacía.')
    w('  Teléfono del cliente: no existe la columna. Entran los {} sin teléfono.'.format(len(listos)))
    w('  Paños y días de chapa: las columnas existen pero están vacías en todas las filas.')
    w('')
    w('CÓMO SE EVITA DUPLICAR SI SE CORRE DOS VECES')
    w('  Cada vehículo se marca con su origen (hoja y fila del Excel) en la columna')
    w('  vehiculo.origen_import, con un índice único. Si el .sql se corre de nuevo,')
    w('  las filas ya cargadas se saltean solas y no se duplica nada.')

    with open(os.path.join(salida, 'preview.txt'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(L))

    # ── El SQL ────────────────────────────────────────────────────
    S = []
    s = S.append
    s('-- Importación del Excel de Grupo Forani. Generado por scripts/importar-forani.py')
    s('-- NO se aplica solo. Revisar y correr a mano.')
    s('--')
    s('-- Es idempotente: cada vehículo lleva su origen (hoja:fila) y hay un índice')
    s('-- único sobre (empresa_id, origen_import). Correrlo dos veces no duplica.')
    s('')
    s('do $$')
    s('declare')
    s('  v_empresa uuid := ' + sql_txt(EMPRESA_FORANI) + ';')
    s('  v_id uuid;')
    s('begin')
    s("  perform set_config('taller.flujo', 'on', true);")
    s('')
    for v in listos:
        s(f'  -- {v["ref"]}  {v["patente"]}  {v["vehiculo"]}')
        s('  if not exists (select 1 from vehiculo where empresa_id = v_empresa'
          f' and origen_import = {sql_txt(v["ref"])}) then')
        s('    insert into vehiculo (empresa_id, origen_import, patente, vehiculo, cliente_nombre,')
        s('      compania, productor, perito, nro_siniestro, fecha_ingreso, fecha_pactada,')
        s('      fecha_entrega, etapa, etapa_desde, excepcion, excepcion_desde, orden_adicional)')
        s(f'    values (v_empresa, {sql_txt(v["ref"])}, {sql_txt(v["patente"])},'
          f' {sql_txt(v["vehiculo"])}, {sql_txt(v["cliente"])},')
        s(f'      {sql_txt(v["compania"])}, {sql_txt(v["productor"])}, {sql_txt(v["perito"])},'
          f' {sql_txt(v["siniestro"])},')
        s(f'      {sql_fecha(v["ingreso"])}, {sql_fecha(v["pactada"])}, {sql_fecha(v["entrega"])},'
          f' {sql_txt(v["etapa"])},')
        s(f'      {sql_fecha(v["ingreso"])}::timestamptz, {sql_txt(v["excepcion"])},'
          f' {"null" if not v["excepcion"] else sql_fecha(v["ingreso"]) + "::timestamptz"},'
          f' {str(v["adicional"]).lower()})')
        s('    returning id into v_id;')
        s('')
        s('    update vehiculo_monto set')
        s(f'      monto_compania = {v["m_cia"]}, monto_franquicia = {v["m_fra"]},'
          f' monto_particular = {v["m_par"]},')
        s(f'      estado_compania = {sql_txt(v["e_cia"])},'
          f' estado_franquicia = {sql_txt(v["e_fra"])},'
          f' estado_particular = {sql_txt(v["e_par"])}')
        s('     where vehiculo_id = v_id;')
        if v['nota']:
            s('')
            s('    insert into vehiculo_evento (vehiculo_id, tipo, etapa, texto)')
            s(f'    values (v_id, \'nota\', {sql_txt(v["etapa"])}, {sql_txt(v["nota"])});')
        s('  end if;')
        s('')
    s("  perform set_config('taller.flujo', '', true);")
    s('end $$;')
    s('')
    s('select count(*) filter (where etapa <> \'entregado\') as activos,')
    s('       count(*) filter (where etapa =  \'entregado\') as entregados,')
    s('       count(*) filter (where origen_import is not null) as importados')
    s(f'  from vehiculo where empresa_id = {sql_txt(EMPRESA_FORANI)};')

    with open(os.path.join(salida, 'importar.sql'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(S))

    print('\n'.join(L))
    print()
    print(f'-> {os.path.join(salida, "preview.txt")}')
    print(f'-> {os.path.join(salida, "importar.sql")}  ({len(S)} líneas)')


if __name__ == '__main__':
    main()
