/**
 * SAU IA: las garantías de interfaz del chat.
 *
 * Son reglas que no se ven fallar hasta que alguien abre la aplicación en un
 * teléfono, y que se rompen con una línea distraída: volver a poner 100vh,
 * bajar el campo a 14px, o "arreglar" el zoom desactivándolo. Se leen de los
 * archivos porque son propiedades del código, no del servidor: no necesitan
 * base de datos ni navegador y corren en medio segundo.
 *
 * Lo que NO prueba esto es cómo se ve. Eso se mira.
 *
 *   node scripts/pruebas-chat-ui.mjs
 */
import fs from 'node:fs'

const leer = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

const css      = leer('../src/styles/chatIa.css')
const jsx      = leer('../src/pages/taller/ChatIA.jsx')
const html     = leer('../index.html')
const taller   = leer('../src/styles/taller.css')

/**
 * El código sin sus comentarios.
 *
 * Hace falta porque varios comentarios explican justamente lo que ya NO se
 * hace —"antes esto usaba scrollIntoView"— y buscar el texto a secas da por
 * roto algo que está bien. Se compara contra lo que se ejecuta.
 */
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ')
const jsxCodigo   = sinComentarios(jsx)
const cssCodigo   = sinComentarios(css)
const tallerCodigo = sinComentarios(taller)

let ok = 0, fail = 0
const fallos = []
const check = (n, c, d = '') => {
  if (c) { ok++; console.log(`  PASA   ${n}`) }
  else { fail++; fallos.push(n); console.log(`  FALLA  ${n}${d ? ' → ' + d : ''}`) }
}

const BR = String.fromCharCode(10)

// ── 1. El zoom del usuario no se toca ────────────────────────────
console.log('1. EL ZOOM ES DEL USUARIO')
{
  const meta = (html.match(/<meta\s+name="viewport"[\s\S]*?\/>/) || [''])[0]
  check('hay una sola etiqueta viewport', (html.match(/name="viewport"/g) || []).length === 1)
  check('no desactiva el zoom con user-scalable', !/user-scalable\s*=\s*no/i.test(meta), meta)
  check('ni lo limita con maximum-scale', !/maximum-scale/i.test(meta), meta)
  check('ni con minimum-scale', !/minimum-scale/i.test(meta))
  check('el teclado achica el viewport en vez de tapar',
        /interactive-widget\s*=\s*resizes-content/.test(meta), meta)
  check('no se pasa toda la app a pantalla completa por el chat',
        !/viewport-fit\s*=\s*cover/.test(meta), meta)
}

// ── 2. Nada de 16px para abajo en lo que se escribe ──────────────
console.log(`${BR}2. EL CAMPO NO PROVOCA ACERCAMIENTO`)
{
  const campo = (css.match(/\.sau-chat-campo\s*\{[^}]*\}/) || [''])[0]
  const tam = Number((campo.match(/font-size:\s*([\d.]+)px/) || [])[1])
  check('el campo de texto declara su tamaño', Number.isFinite(tam), campo)
  check('y es de 16px o más', tam >= 16, `${tam}px`)

  // El botón de enviar y el de cerrar se tocan con el pulgar.
  const enviar = (css.match(/\.sau-chat-enviar\s*\{[^}]*\}/) || [''])[0]
  check('el botón de enviar tiene alto mínimo táctil',
        /min-height:\s*(4[0-9]|[5-9][0-9])px/.test(enviar), enviar)
  const cerrar = (css.match(/\.sau-chat-x\s*\{[^}]*\}/) || [''])[0]
  check('el de cerrar también', /width:\s*(4[0-9]|[5-9][0-9])px/.test(cerrar), cerrar)
}

// ── 3. Altura: dvh, no vh ────────────────────────────────────────
console.log(`${BR}3. LA ALTURA SIGUE AL VIEWPORT DE VERDAD`)
{
  // Ojo con el borde de palabra: en "100dvh" no hay límite entre el 0 y la d,
  // así que /\bdvh\b/ nunca casa. Se busca la unidad tal cual aparece.
  check('el panel usa dvh', /\d+dvh\b/.test(cssCodigo))

  // Cada vh que quede tiene que tener su dvh al lado, como respaldo para
  // navegadores viejos. Un vh suelto es el bug que estamos evitando.
  const reglas = cssCodigo.split('}').filter(r => /\b\d+(\.\d+)?vh\b/.test(r))
  const sinRespaldo = reglas.filter(r => !/\d+dvh\b/.test(r))
  check('ningún alto en vh quedó sin su versión en dvh',
        sinRespaldo.length === 0, sinRespaldo.join(' | ').slice(0, 200))

  check('el cuerpo puede encogerse dentro del panel',
        /\.sau-chat-cuerpo\s*\{[^}]*min-height:\s*0/.test(css))
}

// ── 4. El taller no se mueve por culpa del chat ──────────────────
console.log(`${BR}4. CERRAR DEVUELVE TODO COMO ESTABA`)
{
  check('el panel contiene su propio desplazamiento',
        (css.match(/overscroll-behavior:\s*contain/g) || []).length >= 2,
        'overscroll-behavior: contain')

  check('la conversación se baja moviendo el contenedor, no la página',
        /cuerpoRef\.current/.test(jsxCodigo) && /scrollTop\s*=\s*\w+\.scrollHeight/.test(jsxCodigo))
  check('ya no se llama a scrollIntoView, que arrastraba la pizarra',
        !/scrollIntoView\s*\(/.test(jsxCodigo))

  check('el chat no navega: cerrar no cambia de ruta',
        !/useNavigate|navigate\(/.test(jsxCodigo))
  check('ni bloquea el scroll del documento',
        !/document\.body\.style|overflow\s*=\s*'hidden'/.test(jsxCodigo))
}

// ── 5. Es un componente de SAU, no una pieza del taller ──────────
console.log(`${BR}5. REUTILIZABLE FUERA DEL TALLER`)
{
  check('tiene su propia hoja de estilos', /styles\/chatIa\.css/.test(jsx))
  // En taller.css queda un comentario que dice a dónde se mudó: eso está
  // bien. Lo que no puede quedar es una sola regla del chat.
  check('que ya no vive en la del taller', !/t-ia/.test(tallerCodigo),
        (tallerCodigo.match(/\.t-ia[a-z-]*/g) || []).join(' '))

  check('no usa las clases del taller para vestirse',
        !/className="[^"]*\bt-(input|btn)\b/.test(jsx),
        (jsx.match(/className="[^"]*t-(input|btn)[^"]*"/g) || []).join(' '))

  // Toda variable de color tiene respaldo: montado en otro módulo se ve igual.
  const vars = css.match(/var\(--[a-z0-9-]+(\s*,[^)]*)?\)/g) || []
  const sinRespaldo = vars.filter(v => !v.includes(','))
  check('todas las variables de color tienen valor por defecto',
        sinRespaldo.length === 0, sinRespaldo.join(' '))

  check('no hay ninguna empresa escrita en los estilos',
        !/forani|san\s*mart/i.test(css))
}

// ── 6. Lo que no se tocó ─────────────────────────────────────────
console.log(`${BR}6. LA LÓGICA DE IA QUEDÓ INTACTA`)
{
  check('sigue llamando a la misma función', /invoke\('chat-taller'/.test(jsx))
  check('sigue mandando pregunta y caso', /pregunta:\s*q/.test(jsx) && /caso_id:\s*casoRef/.test(jsx))
  check('el guard de empresa y usuario sigue en su lugar',
        /const HABILITADOS\s*=/.test(jsxCodigo) && /function chatIaHabilitado/.test(jsxCodigo))
  check('y se sigue evaluando antes de dibujar nada',
        /if\s*\(!chatIaHabilitado\([^)]*\)\)\s*return null/.test(jsx))
  check('no se agregó ninguna llamada nueva al backend',
        (jsx.match(/functions\.invoke\(/g) || []).length === 1)
  check('sigue mostrando de qué herramientas salió la respuesta',
        /herramientas/.test(jsx))
}

console.log(`${BR}${'='.repeat(52)}`)
console.log(`RESULTADO: ${ok} pasan, ${fail} fallan`)
if (fail) console.log('Fallaron:' + BR + '  - ' + fallos.join(BR + '  - '))
process.exit(fail ? 1 : 0)
