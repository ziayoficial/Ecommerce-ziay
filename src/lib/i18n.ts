// ───────────────────────────────────────────────────────────────────────────
// Lightweight i18n — no external dependencies (no next-intl)
// SPRINT5-FINAL-001 · Part 1
//
// Spanish (es-CO, es-MX), English (en-US), and Brazilian Portuguese (pt-BR)
// are translated. To add a language, extend `translations` below — no other
// code changes required.
//
// Usage:
//   import { t, getLocale } from '@/lib/i18n'
//   const label = t('nav.catalog')              // uses default locale
//   const label = t('nav.catalog', 'en-US')     // override locale inline
//   const label = t('nav.catalog', 'pt-BR')     // Brazilian Portuguese
//
// The locale is read once per request from the `ZIAY_LOCALE` env var.
// Default is `es-CO` (Colombian Spanish, ZIAY's home market).
//
// SPRINT-MULTICOUNTRY-001 — added `pt-BR` (LATAM expansion, study §18).
// Note: `getAvailableLocales()` still returns the 3 original locales so the
// language picker doesn't surface pt-BR until the front-end sprint wires
// the picker UI. The `t(key, 'pt-BR')` override + `ZIAY_LOCALE=pt-BR` env
// are fully functional today.
// ───────────────────────────────────────────────────────────────────────────

export type Locale = 'es-CO' | 'es-MX' | 'en-US' | 'pt-BR'

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
    // ── SPRINT-MULTICOUNTRY-001 — LATAM expansion (study §18) ──
    'common.currency_format': 'Formato de moeda',
    'common.tax': 'Impuesto',
    'common.payment_method': 'Método de pago',
    'common.pse': 'PSE (transferencia bancaria)',
    'common.pix': 'PIX',
    'common.oxxo': 'OXXO (efectivo)',
    'common.scan_qr': 'Escanea el código QR',
    // ── SPRINT-POLISH-001 — verb-form keys for async UI states ──
    'common.refreshing': 'Actualizando...',
    'common.executing': 'Ejecutando...',
    'common.saving_data': 'Guardando...',
    'common.loading_data': 'Cargando datos...',
    'common.close_dialog': 'Cerrar',
    // ── SPRINT-DOCS-FRONTEND-FINAL-001 — compound search + budget labels ──
    'search.placeholder_product': 'Buscar producto, SKU, diseño...',
    'search.placeholder_ad': 'Buscar ad ID o nombre...',
    'search.placeholder_case': 'Buscar caso, cliente, guía...',
    'search.placeholder_listing': 'Buscar listing...',
    'budget.daily_remaining': '${remaining} restante',
    'budget.percent_used': '${pct}% usado',
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
    // ── SPRINT-MULTICOUNTRY-001 — LATAM expansion (study §18) ──
    'common.currency_format': 'Formato de moeda',
    'common.tax': 'Impuesto',
    'common.payment_method': 'Método de pago',
    'common.pse': 'PSE (transferencia bancaria)',
    'common.pix': 'PIX',
    'common.oxxo': 'OXXO (efectivo)',
    'common.scan_qr': 'Escanea el código QR',
    // ── SPRINT-POLISH-001 — verb-form keys for async UI states ──
    'common.refreshing': 'Actualizando...',
    'common.executing': 'Ejecutando...',
    'common.saving_data': 'Guardando...',
    'common.loading_data': 'Cargando datos...',
    'common.close_dialog': 'Cerrar',
    // ── SPRINT-DOCS-FRONTEND-FINAL-001 — compound search + budget labels ──
    'search.placeholder_product': 'Buscar producto, SKU, diseño...',
    'search.placeholder_ad': 'Buscar ad ID o nombre...',
    'search.placeholder_case': 'Buscar caso, cliente, guía...',
    'search.placeholder_listing': 'Buscar listing...',
    'budget.daily_remaining': '${remaining} restante',
    'budget.percent_used': '${pct}% usado',
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
    // ── SPRINT-MULTICOUNTRY-001 — LATAM expansion (study §18) ──
    'common.currency_format': 'Currency format',
    'common.tax': 'Tax',
    'common.payment_method': 'Payment method',
    'common.pse': 'PSE (bank transfer)',
    'common.pix': 'PIX',
    'common.oxxo': 'OXXO (cash)',
    'common.scan_qr': 'Scan the QR code',
    // ── SPRINT-POLISH-001 — verb-form keys for async UI states ──
    'common.refreshing': 'Refreshing...',
    'common.executing': 'Executing...',
    'common.saving_data': 'Saving...',
    'common.loading_data': 'Loading data...',
    'common.close_dialog': 'Close',
    // ── SPRINT-DOCS-FRONTEND-FINAL-001 — compound search + budget labels ──
    'search.placeholder_product': 'Search product, SKU, design...',
    'search.placeholder_ad': 'Search ad ID or name...',
    'search.placeholder_case': 'Search case, customer, guide...',
    'search.placeholder_listing': 'Search listing...',
    'budget.daily_remaining': '${remaining} remaining',
    'budget.percent_used': '${pct}% used',
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
  'pt-BR': {
    'app.name': 'ZIAY',
    'app.tagline': 'Comércio Conversacional + Atribuição Inteligente',
    'nav.overview': 'Resumo',
    'nav.messenger': 'Mensagens',
    'nav.catalog': 'Catálogo Visual',
    'nav.orders': 'Pedidos & Pagamentos',
    'nav.kanban': 'Kanban operacional',
    'nav.orchestrator': 'Orquestrador',
    'nav.ads': 'Atribuição de Anúncio',
    'nav.monetization': 'Monetização',
    'nav.wallet': 'Carteira',
    'nav.logistics': 'Inteligência Logística',
    'nav.marketplace': 'Marketplace',
    'nav.novedades': 'Novidades',
    'nav.integrations': 'Integrações',
    'nav.settings': 'Configurações',
    'common.save': 'Salvar',
    'common.cancel': 'Cancelar',
    'common.delete': 'Excluir',
    'common.retry': 'Tentar novamente',
    'common.loading': 'Carregando...',
    'common.error': 'Erro',
    'common.search': 'Buscar',
    'common.refresh': 'Atualizar',
    'common.confirm': 'Confirmar',
    'common.close': 'Fechar',
    'common.back': 'Voltar',
    'common.create': 'Criar',
    'common.edit': 'Editar',
    'common.filter': 'Filtrar',
    'common.accept': 'Aceitar',
    'common.last_updated': 'Atualizado há {time}',
    'common.empty_title': 'Sem resultados',
    'common.empty_desc': 'Não há dados para exibir',
    'common.error_title': 'Erro',
    'common.error_desc': 'Não foi possível carregar as informações',
    // ── SPRINT-MULTICOUNTRY-001 — LATAM expansion (study §18) ──
    'common.currency_format': 'Formato de moeda',
    'common.tax': 'Imposto',
    'common.payment_method': 'Forma de pagamento',
    'common.pse': 'PSE (transferência bancária)',
    'common.pix': 'PIX',
    'common.oxxo': 'OXXO (dinheiro)',
    'common.scan_qr': 'Escaneie o código QR',
    // ── SPRINT-POLISH-001 — verb-form keys for async UI states ──
    'common.refreshing': 'Atualizando...',
    'common.executing': 'Executando...',
    'common.saving_data': 'Salvando...',
    'common.loading_data': 'Carregando dados...',
    'common.close_dialog': 'Fechar',
    // ── SPRINT-DOCS-FRONTEND-FINAL-001 — compound search + budget labels ──
    'search.placeholder_product': 'Buscar produto, SKU, design...',
    'search.placeholder_ad': 'Buscar ad ID ou nome...',
    'search.placeholder_case': 'Buscar caso, cliente, guia...',
    'search.placeholder_listing': 'Buscar listing...',
    'budget.daily_remaining': '${remaining} restante',
    'budget.percent_used': '${pct}% usado',
    'login.title': 'ZIAY',
    'login.subtitle': 'Comércio Conversacional + Atribuição Inteligente',
    'login.email': 'E-mail',
    'login.password': 'Senha',
    'login.submit': 'Entrar',
    'login.error': 'E-mail ou senha incorretos',
    'error.title': 'Algo deu errado',
    'error.retry': 'Tentar novamente',
    'notfound.title': 'Página não encontrada',
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

/**
 * Return the configured locales that should appear in the language picker.
 *
 * NOTE: pt-BR is functional today via `t(key, 'pt-BR')` and the
 * `ZIAY_LOCALE=pt-BR` env var, but is NOT surfaced in the picker yet —
 * the front-end sprint will wire the picker UI in a follow-up. See
 * SPRINT-MULTICOUNTRY-001 worklog.
 *
 * Returned shape: a fresh array on each call (no shared mutable state).
 */
export function getAvailableLocales(): Locale[] {
  return ['es-CO', 'es-MX', 'en-US']
}

/**
 * Return ALL configured locales, including the ones not yet surfaced in the
 * picker (pt-BR). Used by the multi-country API endpoints to enumerate
 * valid locale inputs.
 *
 * Returned shape: a fresh array on each call (no shared mutable state).
 */
export function getAllConfiguredLocales(): Locale[] {
  return Object.keys(translations) as Locale[]
}
