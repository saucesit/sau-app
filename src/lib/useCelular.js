import { useEffect, useState } from 'react'

/**
 * Ancho donde el taller deja de ser una pizarra de escritorio y pasa a la
 * disposición apilada. Tiene que coincidir con el @media de taller.css: si se
 * cambia uno sin el otro, el comportamiento y el dibujo dejan de contarse lo
 * mismo (por ejemplo, la tarjeta abriría la ficha con el panel lateral a la vista).
 */
export const ANCHO_CELULAR = 1100

const consulta = `(max-width: ${ANCHO_CELULAR}px)`

/** true cuando el taller está en su disposición de celular/tablet. */
export function useCelular() {
  const [esCelular, setEsCelular] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(consulta).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const alCambiar = (e) => setEsCelular(e.matches)
    mq.addEventListener('change', alCambiar)
    setEsCelular(mq.matches)
    return () => mq.removeEventListener('change', alCambiar)
  }, [])

  return esCelular
}
