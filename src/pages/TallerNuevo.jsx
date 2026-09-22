import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { COMPANIAS } from '../lib/taller'

function Seccion({ children }) {
  return (
    <p className="text-[0.65rem] uppercase tracking-widest text-emerald-400 font-bold border-b border-zinc-800 pb-2 mt-6 mb-3 first:mt-0">
      {children}
    </p>
  )
}

function Campo({ label, obligatorio, children }) {
  return (
    <label className="block mb-3">
      <span className="text-xs text-zinc-400 font-semibold">
        {label}{obligatorio && <span className="text-red-400"> *</span>}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

const inputCls =
  'w-full bg-zinc-950 border border-zinc-800 text-white text-base rounded-xl px-3.5 py-2.5 ' +
  'placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500'

export default function TallerNuevo() {
  const { empresaActivaId, tienePermiso, user } = useAuth()
  const navigate = useNavigate()
  const verMontos = tienePermiso('taller.montos')

  const hoy = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({
    patente: '', vehiculo: '', kilometraje: '', cliente_nombre: '', panos: '',
    compania: COMPANIAS[0], productor: '', perito: '', nro_siniestro: '',
    fecha_ingreso: hoy, fecha_pactada: '',
    monto_compania: '', monto_franquicia: '', monto_particular: '',
  })
  const [fotos,         setFotos]         = useState([])
  const [ordenInterna,  setOrdenInterna]  = useState(null)
  const [ordenCompania, setOrdenCompania] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [error,     setError]     = useState(null)

  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }))

  const faltantes = []
  if (!f.patente.trim())        faltantes.push('patente')
  if (!f.vehiculo.trim())       faltantes.push('vehículo')
  if (!f.cliente_nombre.trim()) faltantes.push('cliente')
  if (!f.fecha_ingreso)         faltantes.push('fecha de ingreso')
  if (!f.fecha_pactada)         faltantes.push('fecha pactada')

  async function subirArchivos(vehiculoId) {
    const pendientes = [
      ...fotos.map(file => ({ file, tipo: 'foto_ingreso' })),
      ...(ordenInterna  ? [{ file: ordenInterna,  tipo: 'orden_interna'  }] : []),
      ...(ordenCompania ? [{ file: ordenCompania, tipo: 'orden_compania' }] : []),
    ]

    for (const { file, tipo } of pendientes) {
      const ext  = file.name.split('.').pop()
      const path = `${empresaActivaId}/${vehiculoId}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const { error: upErr } = await supabase.storage.from('taller').upload(path, file)
      // Si una foto falla no tiramos abajo el ingreso: el vehículo ya quedó cargado.
      if (upErr) { console.error('Error subiendo archivo:', upErr); continue }
      await supabase.from('vehiculo_archivo').insert({
        vehiculo_id: vehiculoId, tipo, path, nombre: file.name, autor_id: user?.id,
      })
    }
  }

  async function guardar() {
    if (faltantes.length) {
      setError(`Falta completar: ${faltantes.join(', ')}`)
      return
    }
    setGuardando(true)
    setError(null)

    const { data, error: insErr } = await supabase
      .from('vehiculo')
      .insert({
        empresa_id:       empresaActivaId,
        patente:          f.patente.trim().toUpperCase(),
        vehiculo:         f.vehiculo.trim(),
        kilometraje:      f.kilometraje ? Number(f.kilometraje) : null,
        cliente_nombre:   f.cliente_nombre.trim(),
        panos:            f.panos ? Number(f.panos) : null,
        compania:         f.compania.trim(),
        productor:        f.productor.trim() || null,
        perito:           f.perito.trim() || null,
        nro_siniestro:    f.nro_siniestro.trim() || null,
        fecha_ingreso:    f.fecha_ingreso,
        fecha_pactada:    f.fecha_pactada,
      })
      .select('id')
      .single()

    if (insErr || !data) {
      setError(insErr?.message || 'No se pudo guardar el vehículo')
      setGuardando(false)
      return
    }

    // Los montos van en su propia tabla, y solo los escribe quien tiene permiso.
    if (verMontos) {
      await supabase.from('vehiculo_monto').insert({
        vehiculo_id:      data.id,
        empresa_id:       empresaActivaId,
        monto_compania:   Number(f.monto_compania   || 0),
        monto_franquicia: Number(f.monto_franquicia || 0),
        monto_particular: Number(f.monto_particular || 0),
      })
    }

    await supabase.from('vehiculo_evento').insert({
      vehiculo_id: data.id, tipo: 'ingreso', etapa: 'recepcion',
      texto: 'Vehículo ingresado al taller', autor_id: user?.id,
    })

    await subirArchivos(data.id)
    navigate(`/taller/${data.id}`, { replace: true })
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-4">

      <Seccion>Datos del vehículo y del caso</Seccion>
      <Campo label="Patente" obligatorio>
        <input className={`${inputCls} uppercase tracking-wide font-bold`} value={f.patente}
               onChange={set('patente')} placeholder="AF 350 PM" />
      </Campo>
      <Campo label="Vehículo (marca y modelo)" obligatorio>
        <input className={inputCls} value={f.vehiculo} onChange={set('vehiculo')} placeholder="Renault Alaskan" />
      </Campo>
      <Campo label="Cliente — nombre y apellido" obligatorio>
        <input className={inputCls} value={f.cliente_nombre} onChange={set('cliente_nombre')}
               placeholder="María Fernanda Agüero" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Kilometraje">
          <input type="number" className={inputCls} value={f.kilometraje} onChange={set('kilometraje')} placeholder="82400" />
        </Campo>
        <Campo label="Paños a trabajar">
          <input type="number" className={inputCls} value={f.panos} onChange={set('panos')} placeholder="3" />
        </Campo>
      </div>

      <Seccion>Compañía, productor y siniestro</Seccion>
      <Campo label="Compañía de seguros" obligatorio>
        <input className={inputCls} value={f.compania} onChange={set('compania')} list="companias" />
        <datalist id="companias">
          {COMPANIAS.map(c => <option key={c} value={c} />)}
        </datalist>
      </Campo>
      <Campo label="N° de siniestro">
        <input className={inputCls} value={f.nro_siniestro} onChange={set('nro_siniestro')} placeholder="80102232599" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Productor">
          <input className={inputCls} value={f.productor} onChange={set('productor')} />
        </Campo>
        <Campo label="Perito">
          <input className={inputCls} value={f.perito} onChange={set('perito')} />
        </Campo>
      </div>

      <Seccion>Fechas</Seccion>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Fecha de ingreso" obligatorio>
          <input type="date" className={inputCls} value={f.fecha_ingreso} onChange={set('fecha_ingreso')} />
        </Campo>
        <Campo label="Fecha pactada" obligatorio>
          <input type="date" className={inputCls} value={f.fecha_pactada} onChange={set('fecha_pactada')} />
        </Campo>
      </div>

      {verMontos && (
        <>
          <Seccion>Montos a facturar</Seccion>
          <Campo label="Monto compañía">
            <input type="number" className={inputCls} value={f.monto_compania} onChange={set('monto_compania')} placeholder="0" />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Franquicia">
              <input type="number" className={inputCls} value={f.monto_franquicia} onChange={set('monto_franquicia')} placeholder="0" />
            </Campo>
            <Campo label="Particular">
              <input type="number" className={inputCls} value={f.monto_particular} onChange={set('monto_particular')} placeholder="0" />
            </Campo>
          </div>
        </>
      )}

      <Seccion>Fotos y documentación</Seccion>

      <label className="block border border-dashed border-zinc-700 rounded-xl p-4 text-center mb-2.5 active:bg-zinc-950">
        <span className="text-2xl block mb-1">📷</span>
        <span className="text-xs text-zinc-400 font-semibold">
          {fotos.length ? `${fotos.length} foto${fotos.length > 1 ? 's' : ''} de ingreso` : 'Sacar fotos de ingreso'}
        </span>
        <input type="file" accept="image/*" capture="environment" multiple className="hidden"
               onChange={e => setFotos(Array.from(e.target.files || []))} />
      </label>

      <label className="block border border-dashed border-zinc-700 rounded-xl p-3 text-center mb-2.5 active:bg-zinc-950">
        <span className="text-xs text-zinc-400 font-semibold">
          📄 {ordenInterna ? ordenInterna.name : 'Orden de trabajo interna (PDF)'}
        </span>
        <input type="file" accept="application/pdf" className="hidden"
               onChange={e => setOrdenInterna(e.target.files?.[0] || null)} />
      </label>

      <label className="block border border-dashed border-zinc-700 rounded-xl p-3 text-center active:bg-zinc-950">
        <span className="text-xs text-zinc-400 font-semibold">
          📄 {ordenCompania ? ordenCompania.name : 'Orden de la compañía (PDF)'}
        </span>
        <input type="file" accept="application/pdf" className="hidden"
               onChange={e => setOrdenCompania(e.target.files?.[0] || null)} />
      </label>

      {error && (
        <p className="text-red-400 text-xs font-semibold bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2.5 mt-4">
          {error}
        </p>
      )}

      <div className="mt-5 pt-4 border-t border-zinc-800 space-y-2.5">
        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full bg-emerald-500 text-black font-extrabold py-3.5 rounded-2xl active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {guardando ? 'Guardando…' : 'Guardar e ingresar a Recepción'}
        </button>
        <button
          onClick={() => navigate('/taller')}
          className="w-full bg-transparent text-zinc-400 border border-zinc-700 font-bold py-3 rounded-2xl"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
