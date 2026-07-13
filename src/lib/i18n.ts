// ───────────────────────────────────────────────────────────────────────────
// Lightweight i18n — no external dependencies (no next-intl)
// SPRINT5-FINAL-001 · Part 1
//
// Currently only Spanish (es-CO) is fully translated. To add a language,
// extend `translations` below — no other code changes required.
//
// Usage:
//   import { t, getLocale } from '@/lib/i18n'
//   const label = t('nav.catalog')              // uses default locale
//   const label = t('nav.catalog', 'en-US')     // override locale inline
//
// The locale is read once per request from the `ZIAY_LOCALE` env var.
// Default is `es-CO` (Colombian Spanish, ZIAY's home market).
// ───────────────────────────────────────────────────────────────────────────

export type Locale = 'es-CO' | 'es-MX' | 'en-US'

const translations: Record<Locale, Record<string, string>> = {
  'es-CO': {
    'app.name': 'ZIAY',
    'app.tagline': 'Comercio Conversacional + Atribución Inteligente',
    'nav.overview': 'Resumen',
    'nav.messenger': 'Mensajería',
    'nav.catalog': 'Catálogo Visual',
    'nav.orders': 'Pedidos & Pagos',
    'nav.kanban': 'Kanban operativo',
    'nav.orchestrator': 'Orquestador',
    'nav.ads': 'Atribución de Pauta',
    'nav.monetization': 'Monetización',
    'nav.wallet': 'Wallet',
    'nav.logistics': 'Inteligencia Logística',
    'nav.marketplace': 'Marketplace',
    'nav.novedades': 'Novedades',
    'nav.integrations': 'Integraciones',
    'nav.settings': 'Configuración',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Eliminar',
    'common.retry': 'Reintentar',
    'common.loading': 'Cargando...',
    'common.error': 'Error',
    'common.search': 'Buscar',
    'common.refresh': 'Refrescar',
    'common.confirm': 'Confirmar',
    'common.close': 'Cerrar',
    'common.back': 'Volver',
    'common.create': 'Crear',
    'common.edit': 'Editar',
    'common.filter': 'Filtrar',
    'common.accept': 'Aceptar',
    'common.last_updated': 'Actualizado hace {time}',
    'common.empty_title': 'Sin resultados',
    'common.empty_desc': 'No hay datos para mostrar',
    'common.error_title': 'Error',
    'common.error_desc': 'No se pudo cargar la información',
    'login.title': 'ZIAY',
    'login.subtitle': 'Comercio Conversacional + Atribución Inteligente',
    'login.email': 'Correo',
    'login.password': 'Contraseña',
    'login.submit': 'Iniciar sesión',
    'login.error': 'Correo o contraseña incorrectos',
    'error.title': 'Algo salió mal',
    'error.retry': 'Reintentar',
    'notfound.title': 'Página no encontrada',
  },
  'es-MX': {
    // Same as es-CO for now — placeholder for future Mexican Spanish.
    // Add overrides here when locale-specific wording is needed.
    'app.name': 'ZIAY',
    'app.tagline': 'Comercio Conversacional + Atribución Inteligente',
    'nav.overview': 'Resumen',
    'nav.messenger': 'Mensajería',
    'nav.catalog': 'Catálogo Visual',
    'nav.orders': 'Pedidos & Pagos',
    'nav.kanban': 'Kanban operativo',
    'nav.orchestrator': 'Orquestador',
    'nav.ads': 'Atribución de Pauta',
    'nav.monetization': 'Monetización',
    'nav.wallet': 'Wallet',
    'nav.logistics': 'Inteligencia Logística',
    'nav.marketplace': 'Marketplace',
    'nav.novedades': 'Novedades',
    'nav.integrations': 'Integraciones',
    'nav.settings': 'Configuración',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Eliminar',
    'common.retry': 'Reintentar',
    'common.loading': 'Cargando...',
    'common.error': 'Error',
    'common.search': 'Buscar',
    'common.refresh': 'Refrescar',
    'common.confirm': 'Confirmar',
    'common.close': 'Cerrar',
    'common.back': 'Volver',
    'common.create': 'Crear',
    'common.edit': 'Editar',
    'common.filter': 'Filtrar',
    'common.accept': 'Aceptar',
    'common.last_updated': 'Actualizado hace {time}',
    'common.empty_title': 'Sin resultados',
    'common.empty_desc': 'No hay datos para mostrar',
    'common.error_title': 'Error',
    'common.error_desc': 'No se pudo cargar la información',
    'login.title': 'ZIAY',
    'login.subtitle': 'Comercio Conversacional + Atribución Inteligente',
    'login.email': 'Correo',
    'login.password': 'Contraseña',
    'login.submit': 'Iniciar sesión',
    'login.error': 'Correo o contraseña incorrectos',
    'error.title': 'Algo salió mal',
    'error.retry': 'Reintentar',
    'notfound.title': 'Página no encontrada',
  },
  'en-US': {
    'app.name': 'ZIAY',
    'app.tagline': 'Conversational Commerce + Intelligent Attribution',
    'nav.overview': 'Overview',
    'nav.messenger': 'Messaging',
    'nav.catalog': 'Visual Catalog',
    'nav.orders': 'Orders & Payments',
    'nav.kanban': 'Operations Kanban',
    'nav.orchestrator': 'Orchestrator',
    'nav.ads': 'Ad Attribution',
    'nav.monetization': 'Monetization',
    'nav.wallet': 'Wallet',
    'nav.logistics': 'Logistics Intelligence',
    'nav.marketplace': 'Marketplace',
    'nav.novedades': 'Incidents',
    'nav.integrations': 'Integrations',
    'nav.settings': 'Settings',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.retry': 'Retry',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.search': 'Search',
    'common.refresh': 'Refresh',
    'common.confirm': 'Confirm',
    'common.close': 'Close',
    'common.back': 'Back',
    'common.create': 'Create',
    'common.edit': 'Edit',
    'common.filter': 'Filter',
    'common.accept': 'Accept',
    'common.last_updated': 'Updated {time} ago',
    'common.empty_title': 'No results',
    'common.empty_desc': 'No data to display',
    'common.error_title': 'Error',
    'common.error_desc': 'Could not load information',
    'login.title': 'ZIAY',
    'login.subtitle': 'Conversational Commerce + Intelligent Attribution',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.error': 'Invalid email or password',
    'error.title': 'Something went wrong',
    'error.retry': 'Try again',
    'notfound.title': 'Page not found',
  },
}

/**
 * Resolve the active locale from the `ZIAY_LOCALE` env var.
 * Defaults to `es-CO` when unset or set to an unknown value.
 *
 * In a future iteration this could read the `Accept-Language` header or a
 * user preference stored on the tenant row — the function signature is
 * already async-friendly for that.
 */
export function getLocale(): Locale {
  const raw = process.env.ZIAY_LOCALE as Locale | undefined
  if (raw && raw in translations) return raw
  return 'es-CO'
}

/**
 * Translate a key. Falls back to `es-CO`, then to the key itself — so a
 * missing translation never breaks the UI, it just shows the key.
 */
export function t(key: string, locale?: Locale): string {
  const loc = locale || getLocale()
  return translations[loc]?.[key] || translations['es-CO']?.[key] || key
}

/** Return all configured locales (for a language picker, if ever needed). */
export function getAvailableLocales(): Locale[] {
  return Object.keys(translations) as Locale[]
}
