import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Si todavía no cargaste las claves en .env.local, la app no se rompe:
// arranca en "modo sin conexión" y muestra un cartel para configurarlas.
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null

/**
 * ¿Es esta la contraseña de este usuario? Sin tocar la sesión abierta.
 *
 * Hace falta para que alguien pueda cambiarse la contraseña probando primero
 * que sabe la actual. `supabase.auth.signInWithPassword` sirve para
 * comprobarlo, pero al hacerlo reemplaza la sesión del cliente y eso vuelve a
 * montar media aplicación. Acá se pregunta al mismo endpoint a mano y se tira
 * la respuesta: lo único que interesa es si la acepta o no.
 */
export async function verificarPassword(email, password) {
  if (!isSupabaseConfigured || !email) return false
  try {
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    return r.ok
  } catch {
    return false
  }
}
