/**
 * Edge Function: solicitar-cae
 *
 * Genera un CAE real en ARCA (AFIP) para una venta fiscal.
 *
 * Flujo:
 *   1. Cargar empresa + certificado desde DB
 *   2. Firmar TRA con PKCS#7 (node-forge)
 *   3. Obtener Token+Sign de WSAA
 *   4. Consultar último número autorizado en WSFEV1
 *   5. Solicitar CAE para la nueva factura
 *   6. Actualizar venta con CAE + numero_comprobante
 *
 * Ambientes:
 *   homologacion → wsaahomo / wswhomo  (para tests)
 *   produccion   → wsaa    / wsfev1    (real)
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import forge from 'npm:node-forge@1.3.1'

// ── Endpoints ARCA ────────────────────────────────────────────────
const WSAA = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion:   'https://wsaa.afip.gov.ar/ws/services/LoginCms',
}
const WSFEV1 = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion:   'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
}

// Tipos de comprobante ARCA
// 1=Factura A (RI→RI), 6=Factura B (RI→CF/Mono/Exento), 11=Factura C (Mono/Exento)
const TIPO_COMP: Record<string, number> = {
  responsable_inscripto: 6,   // FC B por defecto (CF receptor)
  monotributo:           11,  // FC C
  exento:                11,
}

// Alícuotas IVA ARCA
const ALIC_IVA_CODIGO: Record<number, number> = {
  21: 5, 10.5: 4, 27: 6, 0: 3,
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── 1. Crear TRA ──────────────────────────────────────────────────
function crearTRA(): string {
  const now  = new Date()
  const from = new Date(now.getTime() - 10 * 60 * 1000)
  const to   = new Date(now.getTime() + 10 * 60 * 1000)
  const fmt  = (d: Date) => d.toISOString().replace('T', 'T').slice(0, 19) + '-03:00'
  const uid  = Math.floor(Date.now() / 1000).toString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uid}</uniqueId>
    <generationTime>${fmt(from)}</generationTime>
    <expirationTime>${fmt(to)}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`
}

// ── 2. Firmar TRA con PKCS#7 ──────────────────────────────────────
function firmarTRA(traXML: string, certPEM: string, keyPEM: string): string {
  const p7 = forge.pkcs7.createSignedData()
  p7.content = forge.util.createBuffer(traXML, 'utf8')
  p7.addCertificate(certPEM)
  p7.addSigner({
    key:         forge.pki.privateKeyFromPem(keyPEM),
    certificate: forge.pki.certificateFromPem(certPEM),
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
    ],
  })
  p7.sign({ detached: false })
  return forge.util.encode64(
    forge.asn1.toDer(p7.toAsn1()).getBytes()
  )
}

// ── 3. Llamada SOAP genérica ──────────────────────────────────────
async function soapCall(url: string, action: string, bodyInner: string): Promise<string> {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ar="http://ar.gov.afip.dif.FEV1/"
  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov.ar/">
  <soapenv:Header/>
  <soapenv:Body>${bodyInner}</soapenv:Body>
</soapenv:Envelope>`

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction':   action,
    },
    body: envelope,
  })
  if (!res.ok) throw new Error(`SOAP HTTP ${res.status}: ${await res.text()}`)
  return res.text()
}

// ── 4. Parseo XML liviano ─────────────────────────────────────────
function tag(xml: string, tagName: string): string {
  const m = xml.match(new RegExp(`<(?:[\\w:]*:)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w:]*:)?${tagName}>`, 'i'))
  return m ? m[1].trim() : ''
}

// ── 5. Obtener Token+Sign de WSAA ─────────────────────────────────
async function obtenerTA(certPEM: string, keyPEM: string, amb: string) {
  const tra = crearTRA()
  const cms = firmarTRA(tra, certPEM, keyPEM)
  const url = amb === 'produccion' ? WSAA.produccion : WSAA.homologacion

  const xml = await soapCall(url, '', `
    <wsaa:loginCms>
      <in0>${cms}</in0>
    </wsaa:loginCms>`)

  const token = tag(xml, 'token')
  const sign  = tag(xml, 'sign')
  if (!token) throw new Error(`WSAA sin token. Respuesta: ${xml.slice(0, 500)}`)
  return { token, sign }
}

// ── 6. Último comprobante autorizado ─────────────────────────────
async function ultimoNro(
  cuit: string, token: string, sign: string,
  ptoVta: number, tipoComp: number, amb: string
): Promise<number> {
  const url = amb === 'produccion' ? WSFEV1.produccion : WSFEV1.homologacion
  const xml = await soapCall(
    url,
    'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
    `<ar:FECompUltimoAutorizado>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${tipoComp}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>`
  )
  return parseInt(tag(xml, 'CbteNro')) || 0
}

// ── 7. Solicitar CAE ──────────────────────────────────────────────
async function solicitarCAE(params: {
  cuit: string; ptoVta: number; token: string; sign: string
  nro: number; tipoComp: number
  total: number; neto: number; iva: number; alicuota: number
  concepto: number   // 1=productos 2=servicios 3=ambos
  amb: string
}) {
  const { cuit, ptoVta, token, sign, nro, tipoComp,
          total, neto, iva, alicuota, concepto, amb } = params

  const url    = amb === 'produccion' ? WSFEV1.produccion : WSFEV1.homologacion
  const hoy    = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const alivCod = ALIC_IVA_CODIGO[alicuota] ?? 5  // default 21%

  // Para FC C (monotributo) no hay IVA discriminado
  const esMonotributo = tipoComp === 11
  const ivaReal  = esMonotributo ? 0 : iva
  const netoReal = esMonotributo ? total : neto

  const ivaSection = esMonotributo ? '' : `
    <ar:Iva>
      <ar:AlicIva>
        <ar:Id>${alivCod}</ar:Id>
        <ar:BaseImp>${netoReal.toFixed(2)}</ar:BaseImp>
        <ar:Importe>${ivaReal.toFixed(2)}</ar:Importe>
      </ar:AlicIva>
    </ar:Iva>`

  const xml = await soapCall(
    url,
    'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
    `<ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${token}</ar:Token>
        <ar:Sign>${sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${tipoComp}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${concepto}</ar:Concepto>
            <ar:DocTipo>99</ar:DocTipo>
            <ar:DocNro>0</ar:DocNro>
            <ar:CbteDesde>${nro}</ar:CbteDesde>
            <ar:CbteHasta>${nro}</ar:CbteHasta>
            <ar:CbteFch>${hoy}</ar:CbteFch>
            <ar:ImpTotal>${total.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${netoReal.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>${ivaReal.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            ${ivaSection}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>`
  )

  const resultado = tag(xml, 'Resultado')
  if (resultado !== 'A') {
    const msg = tag(xml, 'Msg') || tag(xml, 'FchProceso')
    throw new Error(`ARCA rechazó la factura: ${msg || xml.slice(0, 300)}`)
  }

  const cae     = tag(xml, 'CAE')
  const vtoRaw  = tag(xml, 'CAEFchVto')  // YYYYMMDD
  const vto     = `${vtoRaw.slice(0,4)}-${vtoRaw.slice(4,6)}-${vtoRaw.slice(6,8)}`

  if (!cae) throw new Error('ARCA no devolvió CAE. Revisá la respuesta.')
  return { cae, vencimiento: vto, numero: nro }
}

// ── Handler principal ─────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { venta_id, empresa_id } = await req.json()
    if (!venta_id || !empresa_id) throw new Error('Faltan venta_id y empresa_id')

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ── Cargar empresa ────────────────────────────────────────────
    const { data: emp, error: eEmp } = await sb
      .from('empresa')
      .select('cuit, punto_de_venta, condicion_fiscal')
      .eq('id', empresa_id)
      .single()

    if (eEmp || !emp) throw new Error('Empresa no encontrada')
    if (!emp.cuit)    throw new Error('La empresa no tiene CUIT cargado. Completalo en Mi negocio.')

    // ── Cargar certificado ────────────────────────────────────────
    const { data: cert } = await sb
      .from('certificado_arca')
      .select('cert_pem, key_pem, ambiente')
      .eq('empresa_id', empresa_id)
      .eq('activo', true)
      .single()

    if (!cert) throw new Error('No hay certificado ARCA configurado. Pedíselo a tu contadora.')

    // ── Cargar venta ──────────────────────────────────────────────
    const { data: venta } = await sb
      .from('venta')
      .select('total, neto, iva, alicuota_iva, tipo_comprobante, es_simulacion')
      .eq('id', venta_id)
      .single()

    if (!venta) throw new Error('Venta no encontrada')
    if (venta.es_simulacion) throw new Error('No se solicita CAE en modo práctica')

    // ── Calcular campos ───────────────────────────────────────────
    const cuit      = emp.cuit.replace(/[-\s]/g, '')
    const ptoVta    = emp.punto_de_venta || 1
    const tipoComp  = venta.tipo_comprobante ?? TIPO_COMP[emp.condicion_fiscal] ?? 11
    const total     = Number(venta.total)
    const alicuota  = Number(venta.alicuota_iva ?? 21)
    const iva       = tipoComp === 11 ? 0 : Number(venta.iva ?? (total - total / (1 + alicuota / 100)))
    const neto      = tipoComp === 11 ? total : Number(venta.neto ?? (total - iva))

    // ── 1. Token WSAA ─────────────────────────────────────────────
    const { token, sign } = await obtenerTA(cert.cert_pem, cert.key_pem, cert.ambiente)

    // ── 2. Último número ──────────────────────────────────────────
    const ultimo = await ultimoNro(cuit, token, sign, ptoVta, tipoComp, cert.ambiente)

    // ── 3. CAE ────────────────────────────────────────────────────
    const resultado = await solicitarCAE({
      cuit, ptoVta, token, sign,
      nro:       ultimo + 1,
      tipoComp,
      total, neto, iva, alicuota,
      concepto:  2,   // servicios (más común en pymes)
      amb:       cert.ambiente,
    })

    // ── 4. Actualizar venta ───────────────────────────────────────
    await sb.from('venta').update({
      cae:                resultado.cae,
      cae_vencimiento:    resultado.vencimiento,
      numero_comprobante: resultado.numero,
      tipo_comprobante:   tipoComp,
      neto,
      iva,
    }).eq('id', venta_id)

    return new Response(JSON.stringify({ ok: true, ...resultado }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[solicitar-cae]', msg)
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
