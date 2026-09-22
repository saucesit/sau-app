/**
 * Qué interfaz del módulo Taller le toca a cada empresa.
 *
 * El rediseño de pizarra de control se hizo para Forani, sobre cómo trabaja ese
 * taller en particular. El próximo cliente del rubro arranca con la interfaz
 * clásica de SAU hasta que decidamos si le sirve la misma.
 *
 * El tema sale de `empresa.tema_taller`, en la base: así no hay ids de empresas
 * escritos en el código y cambiárselo a un cliente es un UPDATE, no un deploy.
 */

export const TEMA_CLASICO       = 'clasico'
export const TEMA_CONTROL_BOARD = 'control_board'

export function temaTaller(empresa) {
  return empresa?.tema_taller === TEMA_CONTROL_BOARD ? TEMA_CONTROL_BOARD : TEMA_CLASICO
}
