import { jsPDF } from 'jspdf'

function fmt(n) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)
}
function fmtFecha(iso) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}

const EMERALD = [16, 150, 100]
const DARK    = [30, 30, 35]
const GRAY    = [110, 110, 120]

/**
 * Genera el PDF de un presupuesto. Devuelve { doc, filename }.
 * Soporta modo plantilla (pres.titulo) y modo ítems.
 */
export function generarPdfPresupuesto(pres, items, empresa) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 20                 // margen
  const W = 210 - M * 2        // ancho útil
  const PH = 297               // alto página
  let y = M

  // En documentos mostramos la razón social (nombre formal del negocio)
  const nombreEmpresa = empresa?.razon_social || empresa?.nombre_fantasia || 'SAU'

  function salto(n = 1) { y += n * 6 }
  function checkPage(extra = 0) {
    if (y + extra > PH - M) { doc.addPage(); y = M }
  }
  function texto(str, { size = 10, color = DARK, bold = false, align = 'left' } = {}) {
    if (!str) return
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(String(str), W)
    for (const ln of lines) {
      checkPage(6)
      const x = align === 'right' ? 210 - M : align === 'center' ? 105 : M
      doc.text(ln, x, y, { align })
      y += size * 0.52
    }
  }
  function linea() {
    checkPage(4)
    doc.setDrawColor(220, 220, 225)
    doc.line(M, y, 210 - M, y)
    y += 5
  }

  // ── Encabezado ──────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...EMERALD)
  doc.text(nombreEmpresa, M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GRAY)
  doc.text(fmtFecha(pres.created_at), 210 - M, y, { align: 'right' })
  y += 7
  doc.setFontSize(9); doc.setTextColor(...GRAY)
  doc.text(`Presupuesto N° ${pres.numero}`, M, y)
  y += 4
  linea()

  // ── Cliente ─────────────────────────────────────────────
  texto('CLIENTE', { size: 8, color: GRAY, bold: true })
  texto(pres.cliente_nombre, { size: 12, bold: true })
  if (pres.cliente_tel) texto(pres.cliente_tel, { size: 9, color: GRAY })
  salto()

  const esPlantilla = !!pres.titulo

  if (esPlantilla) {
    // Título del trabajo
    texto(pres.titulo, { size: 13, bold: true, color: EMERALD })
    salto(0.5)
    if (pres.descripcion) { texto(pres.descripcion, { size: 9.5, color: DARK }); salto() }

    if (pres.incluye) {
      texto('INCLUYE', { size: 8, color: GRAY, bold: true })
      pres.incluye.split('\n').filter(Boolean).forEach(l => texto('•  ' + l, { size: 9.5 }))
      salto()
    }

    if (items.length) {
      texto('ADICIONALES', { size: 8, color: GRAY, bold: true })
      items.forEach(it => {
        const monto = it.cantidad * it.precio_unitario
        checkPage(6)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...DARK)
        doc.text('•  ' + it.descripcion, M, y)
        doc.text(fmt(monto), 210 - M, y, { align: 'right' })
        y += 5.5
      })
      salto(0.5)
    }
  } else {
    // Detalle por ítems
    texto('DETALLE', { size: 8, color: GRAY, bold: true })
    items.forEach(it => {
      const monto = it.cantidad * it.precio_unitario
      checkPage(8)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...DARK)
      doc.text(it.descripcion, M, y)
      doc.text(fmt(monto), 210 - M, y, { align: 'right' })
      y += 4.5
      doc.setFontSize(8); doc.setTextColor(...GRAY)
      doc.text(`${it.cantidad} ${it.unidad} × ${fmt(it.precio_unitario)}`, M, y)
      y += 6
    })
    if (pres.descuento > 0) texto(`Descuento: ${pres.descuento}%`, { size: 9, color: GRAY })
    salto(0.5)
  }

  // ── Total ───────────────────────────────────────────────
  linea()
  checkPage(10)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...DARK)
  doc.text('PRECIO TOTAL', M, y)
  doc.setTextColor(...EMERALD); doc.setFontSize(15)
  doc.text(fmt(pres.total), 210 - M, y, { align: 'right' })
  y += 8

  // ── Condiciones ─────────────────────────────────────────
  if (pres.condiciones) {
    linea()
    texto('CONDICIONES DE VENTA', { size: 8, color: GRAY, bold: true })
    texto(pres.condiciones, { size: 9, color: DARK })
  }
  if (pres.notas) { salto(0.5); texto(pres.notas, { size: 9, color: GRAY }) }

  // ── Firma ───────────────────────────────────────────────
  salto(2)
  texto(nombreEmpresa, { size: 10, bold: true, align: 'right' })

  const filename = `Presupuesto-${pres.numero}-${(pres.cliente_nombre || '').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
  return { doc, filename }
}
