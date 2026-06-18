import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

function formatMonto(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)
}

const inputCls = 'w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 outline-none text-white placeholder:text-zinc-600 focus:border-emerald-500 transition-colors text-sm'
const textareaCls = `${inputCls} resize-none leading-relaxed`

const VACIA = { nombre: '', titulo: '', descripcion: '', incluye: '', condiciones: '', precio: '', activo: true }

function PlantillaCard({ p, onEdit }) {
  return (
    <button
      onClick={() => onEdit(p)}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 flex items-center gap-3 active:scale-[0.99] transition-all text-left w-full"
    >
      <div className="flex-1 min-w-0">
        <p className="text-white font-bold truncate">{p.nombre}</p>
        <p className="text-zinc-500 text-xs mt-0.5 truncate">{p.titulo}</p>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <p className="text-emerald-400 font-extrabold text-sm">{formatMonto(p.precio)}</p>
        <span className={`text-[0.6rem] font-bold px-2 py-0.5 rounded-full ${p.activo ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-700 text-zinc-500'}`}>
          {p.activo ? 'Activa' : 'Oculta'}
        </span>
      </div>
      <span className="text-zinc-600 text-lg shrink-0">›</span>
    </button>
  )
}

function PlantillaForm({ inicial, onGuardar, onCancelar, onEliminar, guardando }) {
  const [form, setForm] = useState(inicial)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-4 grid gap-4">
      {/* Nombre corto */}
      <div className="grid gap-1.5">
        <label className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Nombre corto</label>
        <input className={inputCls} placeholder="Ej: Batiente Simple" value={form.nombre}
          onChange={e => set('nombre', e.target.value)} />
        <p className="text-zinc-600 text-xs">Aparece en la lista al crear un presupuesto.</p>
      </div>

      {/* Título del documento */}
      <div className="grid gap-1.5">
        <label className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Título del documento</label>
        <input className={inputCls} placeholder="Ej: Portón Batiente Simple 3m" value={form.titulo}
          onChange={e => set('titulo', e.target.value)} />
      </div>

      {/* Descripción técnica */}
      <div className="grid gap-1.5">
        <label className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Descripción técnica</label>
        <textarea rows={4} className={textareaCls}
          placeholder="Describí el trabajo: materiales, medidas, motor, etc."
          value={form.descripcion} onChange={e => set('descripcion', e.target.value)} />
      </div>

      {/* Incluye */}
      <div className="grid gap-1.5">
        <label className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Incluye</label>
        <textarea rows={3} className={textareaCls}
          placeholder="Ej: – Motor 1/2 HP&#10;– Rieles&#10;– Control remoto x2"
          value={form.incluye} onChange={e => set('incluye', e.target.value)} />
      </div>

      {/* Condiciones */}
      <div className="grid gap-1.5">
        <label className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Condiciones</label>
        <textarea rows={2} className={textareaCls}
          placeholder="Ej: 50% adelanto, saldo contra entrega. Garantía 1 año."
          value={form.condiciones} onChange={e => set('condiciones', e.target.value)} />
      </div>

      {/* Precio */}
      <div className="grid gap-1.5">
        <label className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Precio base</label>
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 font-bold text-lg">$</span>
          <input type="number" className={`${inputCls} text-lg font-extrabold`}
            placeholder="0" value={form.precio}
            onChange={e => set('precio', e.target.value)} />
        </div>
        <p className="text-zinc-600 text-xs">Editable al momento de crear cada presupuesto.</p>
      </div>

      {/* Activo toggle */}
      <button
        onClick={() => set('activo', !form.activo)}
        className={`w-full py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 border ${
          form.activo
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-zinc-800 border-zinc-700 text-zinc-500'
        }`}
      >
        {form.activo ? '✓ Visible al crear presupuestos' : 'Oculta (no aparece al crear)'}
      </button>

      {/* Acciones */}
      <div className="grid gap-2 pt-1">
        <button
          onClick={() => onGuardar(form)}
          disabled={guardando || !form.nombre.trim() || !form.precio}
          className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-extrabold text-base shadow-lg shadow-emerald-500/20 disabled:opacity-40 active:scale-95 transition-all"
        >
          {guardando ? 'Guardando...' : '✓ Guardar cambios'}
        </button>
        <button onClick={onCancelar}
          className="w-full py-3 rounded-2xl border border-zinc-700 text-zinc-400 font-bold active:scale-95 transition-all">
          Cancelar
        </button>
        {onEliminar && (
          <button onClick={onEliminar}
            className="w-full py-3 rounded-2xl border border-red-500/30 text-red-400 font-bold text-sm active:scale-95 transition-all">
            Eliminar plantilla
          </button>
        )}
      </div>
    </div>
  )
}

export default function PlantillasAdmin() {
  const { empresaActivaId, tienePermiso } = useAuth()
  const navigate = useNavigate()
  const puedeAprobar = tienePermiso('empresa.admin')

  const [plantillas, setPlantillas] = useState([])
  const [cargando,   setCargando]   = useState(true)
  const [editando,   setEditando]   = useState(null)   // plantilla en edición o 'nueva'
  const [guardando,  setGuardando]  = useState(false)
  const [ok,         setOk]         = useState(null)

  useEffect(() => {
    if (!puedeAprobar) { navigate('/presupuestos', { replace: true }); return }
    cargar()
  }, [empresaActivaId])

  async function cargar() {
    setCargando(true)
    const { data } = await supabase
      .from('plantilla_presupuesto')
      .select('*')
      .eq('empresa_id', empresaActivaId)
      .order('orden')
    setPlantillas(data || [])
    setCargando(false)
  }

  async function guardar(form) {
    setGuardando(true)
    const payload = {
      empresa_id:  empresaActivaId,
      nombre:      form.nombre.trim(),
      titulo:      form.titulo.trim(),
      descripcion: form.descripcion.trim(),
      incluye:     form.incluye.trim(),
      condiciones: form.condiciones.trim(),
      precio:      parseFloat(form.precio) || 0,
      activo:      form.activo,
    }

    if (form.id) {
      await supabase.from('plantilla_presupuesto').update(payload).eq('id', form.id)
    } else {
      const maxOrden = plantillas.length ? Math.max(...plantillas.map(p => p.orden || 0)) + 1 : 0
      await supabase.from('plantilla_presupuesto').insert({ ...payload, orden: maxOrden })
    }

    await cargar()
    setEditando(null)
    setGuardando(false)
    setOk(form.id ? 'Cambios guardados' : 'Plantilla creada')
    setTimeout(() => setOk(null), 2500)
  }

  async function eliminar(id) {
    if (!window.confirm('¿Eliminar esta plantilla?')) return
    await supabase.from('plantilla_presupuesto').delete().eq('id', id)
    await cargar()
    setEditando(null)
  }

  return (
    <div className="grid gap-4 pb-8 pt-1">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/presupuestos')}
          className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 active:scale-95 transition-all shrink-0">
          ‹
        </button>
        <div>
          <h1 className="text-white font-extrabold text-xl leading-tight">Mis plantillas</h1>
          <p className="text-zinc-500 text-xs">Modelos de presupuesto y precios base</p>
        </div>
      </div>

      {/* Toast ok */}
      {ok && (
        <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-2xl px-4 py-3 text-emerald-400 font-bold text-sm text-center">
          ✓ {ok}
        </div>
      )}

      {cargando ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
        </div>
      ) : editando ? (
        <PlantillaForm
          inicial={editando === 'nueva' ? { ...VACIA } : editando}
          onGuardar={guardar}
          onCancelar={() => setEditando(null)}
          onEliminar={editando !== 'nueva' ? () => eliminar(editando.id) : null}
          guardando={guardando}
        />
      ) : (
        <>
          {plantillas.length === 0 ? (
            <div className="text-center py-12 grid gap-2">
              <p className="text-5xl">📋</p>
              <p className="text-zinc-300 font-bold text-lg">Todavía no hay plantillas</p>
              <p className="text-zinc-500 text-sm">Creá tu primer modelo abajo.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest px-1">
                {plantillas.length} plantilla{plantillas.length !== 1 ? 's' : ''}
              </p>
              {plantillas.map(p => (
                <PlantillaCard key={p.id} p={p} onEdit={setEditando} />
              ))}
            </div>
          )}

          <button
            onClick={() => setEditando('nueva')}
            className="w-full py-4 rounded-3xl border-2 border-dashed border-zinc-700 text-zinc-400 font-bold text-sm active:scale-95 transition-all hover:border-emerald-500/40 hover:text-emerald-400"
          >
            + Nueva plantilla
          </button>
        </>
      )}
    </div>
  )
}
