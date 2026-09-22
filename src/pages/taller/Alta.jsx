import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { COMPANIAS } from '../../lib/taller'

function Campo({ label, obligatorio, ancho, children }) {
  return (
    <label className={`t-field${ancho ? ' ancho' : ''}`}>
      <span className="t-label">
        {label}{obligatorio && <span className="t-req"> *</span>}
      </span>
      {children}
    </label>
  )
}

export default function Alta() {
  const { empresaActivaId, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const verMontos = tienePermiso('taller.montos')

  const hoy = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({
    patente: '', vehiculo: '', kilometraje: '', cliente_nombre: '', panos: '',
    compania: '', productor: '', perito: '', nro_siniestro: '',
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
  if (!f.compania.trim())       faltantes.push('compañía')
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
        vehiculo_id: vehiculoId, tipo, path, nombre: file.name,
      })
    }
  }

  async function guardar() {
    if (faltantes.length) return setError(`Falta completar: ${faltantes.join(', ')}`)
    setGuardando(true)
    setError(null)

    const { data, error: insErr } = await supabase
      .from('vehiculo')
      .insert({
        empresa_id:     empresaActivaId,
        patente:        f.patente.trim(),
        vehiculo:       f.vehiculo.trim(),
        kilometraje:    f.kilometraje ? Number(f.kilometraje) : null,
        cliente_nombre: f.cliente_nombre.trim(),
        panos:          f.panos ? Number(f.panos) : null,
        compania:       f.compania.trim(),
        productor:      f.productor.trim() || null,
        perito:         f.perito.trim() || null,
        nro_siniestro:  f.nro_siniestro.trim() || null,
        fecha_ingreso:  f.fecha_ingreso,
        fecha_pactada:  f.fecha_pactada,
      })
      .select('id')
      .single()

    if (insErr || !data) {
      setError(insErr?.message || 'No se pudo guardar el vehículo')
      setGuardando(false)
      return
    }

    // La fila de montos la crea un trigger en cero, así existe aunque el
    // vehículo lo cargue un coordinador. Acá solo la completa quien puede.
    if (verMontos) {
      await supabase.from('vehiculo_monto')
        .update({
          monto_compania:   Number(f.monto_compania   || 0),
          monto_franquicia: Number(f.monto_franquicia || 0),
          monto_particular: Number(f.monto_particular || 0),
        })
        .eq('vehiculo_id', data.id)
    }

    await subirArchivos(data.id)
    navigate(`/taller/${data.id}`, { replace: true })
  }

  return (
    <main className="t-page">
      <p className="t-eyebrow">NUEVA ORDEN</p>
      <h1 className="t-h1">Ingreso de vehículo</h1>
      <p className="t-sub">Entra directo a Recepción. Las fotos son el respaldo de cómo llegó.</p>

      <div style={{ marginTop: 20 }}>
        {error && <p className="t-error">{error}</p>}

        <section className="t-panel">
          <p className="t-legend">VEHÍCULO Y CLIENTE</p>
          <div className="t-grid">
            <Campo label="Patente" obligatorio>
              <input className="t-input mono" value={f.patente} onChange={set('patente')} placeholder="AF350PM" />
            </Campo>
            <Campo label="Vehículo (marca y modelo)" obligatorio>
              <input className="t-input" value={f.vehiculo} onChange={set('vehiculo')} placeholder="Renault Alaskan" />
            </Campo>
            <Campo label="Cliente" obligatorio ancho>
              <input className="t-input" value={f.cliente_nombre} onChange={set('cliente_nombre')}
                     placeholder="María Fernanda Agüero" />
            </Campo>
            <Campo label="Kilometraje">
              <input type="number" className="t-input" value={f.kilometraje} onChange={set('kilometraje')} placeholder="82400" />
            </Campo>
            <Campo label="Paños a trabajar">
              <input type="number" className="t-input" value={f.panos} onChange={set('panos')} placeholder="3" />
            </Campo>
          </div>
        </section>

        <section className="t-panel">
          <p className="t-legend">COMPAÑÍA Y SINIESTRO</p>
          <div className="t-grid">
            <Campo label="Compañía de seguros" obligatorio>
              <input className="t-input" value={f.compania} onChange={set('compania')} list="t-companias" />
              <datalist id="t-companias">
                {COMPANIAS.map(c => <option key={c} value={c} />)}
              </datalist>
            </Campo>
            <Campo label="N° de siniestro">
              <input className="t-input mono" value={f.nro_siniestro} onChange={set('nro_siniestro')} placeholder="80102232599" />
            </Campo>
            <Campo label="Productor">
              <input className="t-input" value={f.productor} onChange={set('productor')} />
            </Campo>
            <Campo label="Perito">
              <input className="t-input" value={f.perito} onChange={set('perito')} />
            </Campo>
          </div>
        </section>

        <section className="t-panel">
          <p className="t-legend">PLAZOS</p>
          <div className="t-grid">
            <Campo label="Fecha de ingreso" obligatorio>
              <input type="date" className="t-input" value={f.fecha_ingreso} onChange={set('fecha_ingreso')} />
            </Campo>
            <Campo label="Fecha pactada de entrega" obligatorio>
              <input type="date" className="t-input" value={f.fecha_pactada} onChange={set('fecha_pactada')} />
            </Campo>
          </div>
        </section>

        {verMontos && (
          <section className="t-panel">
            <p className="t-legend">MONTOS A FACTURAR</p>
            <div className="t-grid">
              <Campo label="Compañía">
                <input type="number" className="t-input mono" value={f.monto_compania} onChange={set('monto_compania')} placeholder="0" />
              </Campo>
              <Campo label="Franquicia">
                <input type="number" className="t-input mono" value={f.monto_franquicia} onChange={set('monto_franquicia')} placeholder="0" />
              </Campo>
              <Campo label="Particular" ancho>
                <input type="number" className="t-input mono" value={f.monto_particular} onChange={set('monto_particular')} placeholder="0" />
              </Campo>
            </div>
          </section>
        )}

        <section className="t-panel">
          <p className="t-legend">RESPALDO DE INGRESO</p>
          <div className="t-grid">
            <label className={`t-drop ancho${fotos.length ? ' cargado' : ''}`} style={{ gridColumn: '1 / -1' }}>
              {fotos.length
                ? `${fotos.length} foto${fotos.length > 1 ? 's' : ''} de ingreso`
                : 'Sacar fotos del estado en que llegó'}
              <input type="file" accept="image/*" capture="environment" multiple hidden
                     onChange={e => setFotos(Array.from(e.target.files || []))} />
            </label>
            <label className={`t-drop${ordenInterna ? ' cargado' : ''}`}>
              {ordenInterna ? ordenInterna.name : 'Orden de trabajo interna (PDF)'}
              <input type="file" accept="application/pdf" hidden
                     onChange={e => setOrdenInterna(e.target.files?.[0] || null)} />
            </label>
            <label className={`t-drop${ordenCompania ? ' cargado' : ''}`}>
              {ordenCompania ? ordenCompania.name : 'Orden de la compañía (PDF)'}
              <input type="file" accept="application/pdf" hidden
                     onChange={e => setOrdenCompania(e.target.files?.[0] || null)} />
            </label>
          </div>
        </section>

        <div className="t-acciones">
          <button className="t-btn" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Ingresar a Recepción'}
          </button>
          <button className="t-btn fantasma" onClick={() => navigate('/taller')}>Cancelar</button>
        </div>
      </div>
    </main>
  )
}
