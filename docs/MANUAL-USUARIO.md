# Manual Maestro de Usuario — ZIAY

**Versión:** v0.4.0 "Comercio Agéntico"
**Fecha:** Julio 2026
**Plataforma:** ZIAY · Comercio Conversacional + Atribución Inteligente

---

## Tabla de Contenidos

1. [Introducción](#1-introducción)
2. [Primeros Pasos](#2-primeros-pasos)
3. [Roles y Permisos](#3-roles-y-permisos)
4. [Navegación del Dashboard](#4-navegación-del-dashboard)
5. [Módulo: Resumen (Overview)](#5-módulo-resumen)
6. [Módulo: Mensajería](#6-módulo-mensajería)
7. [Módulo: Catálogo Visual](#7-módulo-catálogo-visual)
8. [Módulo: Pedidos & Pagos](#8-módulo-pedidos--pagos)
9. [Módulo: Kanban Operativo](#9-módulo-kanban-operativo)
10. [Módulo: Orquestador de Agentes](#10-módulo-orquestador-de-agentes)
11. [Módulo: Costos de IA](#11-módulo-costos-de-ia)
12. [Módulo: Atribución de Pauta](#12-módulo-atribución-de-pauta)
13. [Módulo: Monetización](#13-módulo-monetización)
14. [Módulo: Wallet](#14-módulo-wallet)
15. [Módulo: Inteligencia Logística](#15-módulo-inteligencia-logística)
16. [Módulo: Marketplace](#16-módulo-marketplace)
17. [Módulo: Novedades](#17-módulo-novedades)
18. [Módulo: Gobernanza](#18-módulo-gobernanza)
19. [Módulo: Catálogo e Integraciones](#19-módulo-catálogo-e-integraciones)
20. [Módulo: Configuración](#20-módulo-configuración)
21. [Páginas Públicas](#21-páginas-públicas)
22. [Compliance Regulatorio](#22-compliance-regulatorio)
23. [Protocolos Agénticos](#23-protocolos-agénticos)
24. [Atajos de Teclado](#24-atajos-de-teclado)
25. [PWA — App Instalable](#25-pwa--app-instalable)
26. [Solución de Problemas](#26-solución-de-problemas)
27. [Glosario](#27-glosario)
28. [Resultados de QA](#resultados-de-qa)

---

## 1. Introducción

### ¿Qué es ZIAY?

ZIAY es una plataforma de **comercio conversacional con atribución inteligente** diseñada para el mercado LATAM. Permite gestionar conversaciones de WhatsApp, Messenger e Instagram, procesar pedidos, atribuir ventas a anuncios, y operar con agentes de IA — todo desde un solo dashboard.

### Marcas operando en ZIAY

| Marca | Tipo | Especialidad |
|-------|------|--------------|
| **Saramantha** | Pijamas | Moda casa, tela fría |
| **Sublimados Majestic** | Personalizados | Sublimación, regalos |
| **Lovely Pijamas** | Pijamas | Moda casa, económico |
| **Sueño de Reina** | Pijamas | Premium, algodón |

### Capacidades principales

- **24 agentes de IA** (20 consolidados + 4 control-plane) cubriendo pre-venta, post-venta, inteligencia, compliance, fintech y monitoreo
- **5 protocolos agénticos** (AP2, UCP, ACP, MCP, A2A) para interoperabilidad con agentes externos
- **8 métodos de pago** (4 tarjetas + 4 locales LATAM)
- **7 monedas** (COP, MXN, BRL, USD, PEN, CLP, ARS)
- **6 módulos de compliance** regulatorio Colombia
- **16 servicios Docker** con monitoring stack completo

---

## 2. Primeros Pasos

### Requisitos

- Navegador moderno (Chrome, Firefox, Safari, Edge — última versión)
- Conexión a internet estable
- Cuenta de usuario activa en ZIAY

### Inicio de Sesión

1. Ve a la URL de tu instancia ZIAY (ej: `https://tu-dominio.co/login`)
2. Ingresa tu correo y contraseña
3. Haz clic en **Iniciar sesión**

### Cuentas de Demostración

| Rol | Correo | Contraseña | Acceso |
|-----|--------|------------|--------|
| **Admin** | valentina@saramantha.co | demo123 | Todas las vistas + configuración |
| **Agente** | camila@saramantha.co | demo123 | Mensajería, pedidos, catálogo, novedades |
| **Trafficker** | sebastian@trafficker.co | demo123 | Atribución, wallet, campañas |

> **Nota:** Los botones de demo en la página de login rellenan y envían automáticamente — un solo clic.

### Primer Dashboard

Al iniciar sesión verás el **Resumen** (vista por defecto) con:
- 4 KPI cards (Ingresos, ROAS, Pedidos, Inversión)
- Gráfico de ingresos vs inversión (14 días)
- Distribución de pedidos por canal
- Conversaciones recientes

---

## 3. Roles y Permisos

ZIAY implementa control de acceso basado en roles (RBAC) con 6 roles:

| Rol | Descripción | Acceso Principal |
|-----|-------------|------------------|
| **Admin** | Control total del tenant | Todas las vistas + configuración + compliance |
| **Agent** | Atención al cliente | Mensajería, pedidos, catálogo, novedades |
| **Trafficker** | Gestión de pauta | Atribución, wallet, campañas |
| **Finance** | Gestión financiera | Monetización, wallet, facturación DIAN |
| **Support** | Soporte post-venta | Novedades, logística, gobernanza |
| **Marketing** | Marketing y remarketing | Ads, marketplace, remarketing |

### Permisos por módulo

| Módulo | Admin | Agent | Trafficker | Finance | Support |
|--------|-------|-------|------------|---------|---------|
| Resumen | ✅ | ✅ | ✅ | ✅ | ✅ |
| Mensajería | ✅ | ✅ | — | — | ✅ |
| Catálogo | ✅ | ✅ | — | — | — |
| Pedidos | ✅ | ✅ | — | ✅ | ✅ |
| Kanban | ✅ | ✅ | — | — | ✅ |
| Orquestador | ✅ | ✅ | — | — | — |
| Costos IA | ✅ | — | ✅ | ✅ | — |
| Atribución | ✅ | — | ✅ | — | — |
| Monetización | ✅ | — | — | ✅ | — |
| Wallet | ✅ | — | ✅ | ✅ | — |
| Logística | ✅ | — | — | — | ✅ |
| Marketplace | ✅ | — | — | — | — |
| Novedades | ✅ | ✅ | — | — | ✅ |
| Gobernanza | ✅ | — | — | ✅ | ✅ |
| Integraciones | ✅ | — | — | — | — |
| Configuración | ✅ | — | — | — | — |

---

## 4. Navegación del Dashboard

### Sidebar (barra lateral)

El sidebar contiene **16 módulos** organizados por categoría. En móvil, se convierte en un menú hamburguesa.

### Topbar (barra superior)

- **Breadcrumb:** Dashboard / [Vista activa]
- **Selector de tenant:** Cambia entre marcas (solo admin)
- **Selector de país:** Filtra por país (Todos, Colombia, México, etc.)
- **Búsqueda rápida (⌘K):** Paleta de comandos para navegar entre vistas
- **Notificaciones:** Contador de conversaciones no leídas
- **Cambio de tema:** Claro / Oscuro / Sistema
- **Menú de usuario:** Nombre, rol, cerrar sesión

### Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `⌘K` / `Ctrl+K` | Abrir paleta de comandos |
| `?` | Abrir paleta de comandos (alternativa) |
| `1` - `9` | Saltar a las primeras 9 vistas |
| `Enter` | Enviar mensaje (en mensajería) |
| `Shift+Enter` | Salto de línea (en mensajería) |

---

## 5. Módulo: Resumen

### ¿Qué muestra?

KPIs principales del negocio en los últimos 14 días:

- **Ingresos (14d):** Total de ventas en COP
- **ROAS:** Return on Ad Spend (ingresos / inversión en pauta)
- **Pedidos:** Número de pedidos confirmados
- **Inversión en pauta:** Total gastado en anuncios

### Funciones

- **Tooltip informativo:** Pasa el mouse sobre cada KPI para ver su definición
- **Refrescar:** Botón para actualizar datos manualmente
- **Indicador "Actualizado hace X":** Muestra cuándo se cargaron los datos por última vez
- **Gráfico de área:** Ingresos vs inversión día por día
- **Distribución por canal:** Pedidos por WhatsApp, Messenger, Instagram
- **Conversaciones recientes:** Últimas 5 conversaciones activas

### Estados

- **Cargando:** Skeleton gray con animación
- **Error:** Alerta roja con botón "Reintentar"
- **Vacío:** Icono + mensaje "Sin datos" + CTA a Mensajería

---

## 6. Módulo: Mensajería

### ¿Qué es?

Centro unificado de conversaciones de WhatsApp, Messenger e Instagram con agentes de IA integrados.

### Panel izquierdo — Lista de conversaciones

- **Buscar:** Filtra por nombre del cliente o número
- **Filtro de estado:** Abiertas, cerradas, todas
- **Badge de no leídos:** Contador rojo por conversación
- **Preview:** Último mensaje (2 líneas visibles)
- **Refresh:** Botón para recargar conversaciones

### Panel derecho — Conversación activa

- **Historial de mensajes:** Burbujas de chat (cliente izquierda, agente derecha)
- **Indicador de escritura:** 3 puntos animados cuando la IA responde
- **Respuestas rápidas:** 5 chips con respuestas comunes sobre el composer
- **Input de mensaje:** Caja de texto con hint "Enter enviar · ⇧+Enter salto"
- **Enviar:** Botón con icono de avión

### Agentes de IA disponibles

La IA responde automáticamente usando estos agentes según el contexto:

1. **Perfilamiento** — Detecta si el cliente es mayorista, emprendedor o detal
2. **Discurso** — Genera respuestas con el tono de la marca
3. **Cotización** — Cotiza productos del catálogo
4. **Catálogo** — Recomienda productos
5. **Objeciones** — Maneja dudas y objeciones
6. **Dirección** — Recopila dirección de envío
7. **Logística** — Informa sobre envíos y tiempos
8. **Checkout** — Procesa el pago
9. **Visión** — Identifica productos desde imágenes

### Comandos de WhatsApp (cliente)

Los clientes pueden enviar estas palabras clave:

| Comando | Acción |
|---------|--------|
| `SI` / `ACEPTO` | Acepta recibir mensajes marketing |
| `STOP` / `BAJA` | Cancela mensajes marketing |
| `AYUDA` | Muestra comandos disponibles |
| `RETRACTO` | Solicita retracto (cancelación dentro de 5 días) |

---

## 7. Módulo: Catálogo Visual

### ¿Qué es?

Visualización del catálogo en modo cuadrícula o lista, con capacidad de chatear con la IA sobre cada producto.

### Funciones

- **Vista cuadrícula:** Tarjetas con imagen, nombre, precio, stock
- **Vista lista:** Filas compactas con más detalle
- **Buscar:** Por nombre, SKU o diseño
- **Filtros:** Por diseño, categoría, orden (precio, nombre)
- **Click en producto:** Abre panel lateral con detalles + botón "Enviar a chat"
- **Identificación IA:** Botón para que la IA identifique un producto desde una imagen

### Estados

- Skeleton de 4 tarjetas mientras carga
- Empty state con icono + "Sin productos con estos filtros" + botón "Limpiar filtros"
- Error con Alert + Reintentar

---

## 8. Módulo: Pedidos & Pagos

### ¿Qué es?

Gestión completa de pedidos con estados, pagos, atribución y exportación.

### Tabla de pedidos

Cada pedido muestra:

| Columna | Descripción |
|---------|-------------|
| Checkbox | Selección para acciones masivas |
| Pedido # | Número + fecha |
| Cliente | Nombre + teléfono |
| Items | Productos + cantidades |
| Total | Valor en COP |
| Estado | Pagado, Pendiente, Enviado, Entregado, Cancelado |
| Pago | Anticipado, Contra entrega |
| Atribución | Canal + campaña de origen |
| Acciones | Ver detalle, editar |

### Funciones

- **Exportar CSV:** Descarga todos los pedidos o solo los seleccionados (formato Excel con BOM UTF-8)
- **Acciones masivas:** Seleccionar múltiples pedidos + mover de estado + exportar selección
- **Filtros colapsables:** Por estado, canal, método de pago, búsqueda
- **Chips de estado:** Contadores visibles arriba de la tabla (8 estados + "Todos")
- **Scroll horizontal:** Tabla con `overflow-x-auto` en móvil
- **Columna sticky:** Checkbox fijo al hacer scroll horizontal

### Retracto (Ley 1480 Art 47)

En pedidos dentro de la ventana de 5 días, aparece un botón **"Retracto"** que:
1. Cancela el orden automáticamente
2. Procesa el reembolso vía la pasarela de pago (si el pago fue procesado)
3. Registra el evento en el historial del pedido
4. Cumple con el plazo legal de 30 días para reembolso

---

## 9. Módulo: Kanban Operativo

### ¿Qué es?

Tablero Kanban con 8 columnas representando las etapas del proceso operativo (Saramantha §10):

1. **Lead entra** — Nueva conversación
2. **Cotizando** — Enviando catálogo/precios
3. **Datos completados** — Dirección y datos del cliente
4. **Pago confirmado** — Anticipado o confirmado
5. **En preparación** — Armando el pedido
6. **Despachado** — Guía generada
7. **Entregado** — Confirmación de entrega
8. **Seguimiento WA** — Post-venta por WhatsApp

### Funciones

- **Drag & Drop:** Arrastra tarjetas entre columnas (guarda automáticamente)
- **WIP Limits:** Límite de tarjetas por columna con indicador visual
- **Indicador de estancamiento:** Chip amber si una tarjeta lleva >3 días sin moverse
- **Columnas colapsables:** Contrae columnas para ver solo emoji + label vertical
- **Indicador "100% despachado":** Progreso del día
- **Refresh + lastUpdated:** Actualización manual + timestamp

---

## 10. Módulo: Orquestador de Agentes

### ¿Qué es?

Ejecuta secuencias de 9 agentes de IA en pipeline para procesar una conversación end-to-end.

### Pipeline de 9 pasos

| Paso | Agente | Función |
|------|--------|---------|
| 1 | Perfilamiento | Detecta tipo de cliente |
| 2 | Discurso | Genera saludo con tono de marca |
| 3 | Catálogo | Recomienda productos |
| 4 | Cotización | Cotiza productos seleccionados |
| 5 | Objeciones | Maneja dudas |
| 6 | Dirección | Recopila dirección |
| 7 | Logística | Informa envío |
| 8 | Checkout | Procesa pago |
| 9 | Visión | Identifica producto desde imagen |

### Funciones

- **Ejecutar todo:** Corre los 9 pasos en secuencia
- **Siguiente paso:** Ejecuta solo el siguiente paso del pipeline
- **Seleccionar escenario:** 4 escenarios preconfigurados (lead mayorista, emprendedora, etc.)
- **Timeline de respuestas:** Muestra el output de cada agente con timestamp
- **Reiniciar:** Limpia el pipeline y empieza de nuevo
- **Barra de progreso:** Indica el paso actual del pipeline

### Gobernanza automática

- Si una decisión tiene **confidence < 0.6**, se escala a revisión humana
- Si el carrito excede los límites del mandato AP2, se bloquea
- Si la orden supera COP 5M, requiere aprobación humana

---

## 11. Módulo: Costos de IA

### ¿Qué es?

Dashboard de costos y uso de LLM (Large Language Models) por agente, modelo y día.

### KPIs principales

- **Costo total (30d):** Gasto en USD
- **Tokens totales:** Tokens consumidos (prompt + completion)
- **Llamadas totales:** Número de invocaciones a LLM
- **Latencia promedio:** Tiempo de respuesta en milisegundos

### Presupuesto

- **Presupuesto diario:** $10 USD/día (configurable)
- **Presupuesto mensual:** $200 USD/mes (configurable)
- **Barra de progreso:** Verde <80%, Amber 80-95%, Rojo >95%
- **Banner de advertencia:** Aparece cuando se alcanza el 80% del presupuesto

### Desgloses

- **Por día:** Gráfico de área con costo diario (30 días)
- **Por agente:** Tabla con llamadas, tokens y costo por agente
- **Por modelo:** Tabla con llamadas, tokens y costo por modelo (glm-4.6, gpt-4o, etc.)

### Configuración (admin)

- Modificar presupuesto diario y mensual
- Cuando se excede el presupuesto, las llamadas LLM se bloquean con error 429

---

## 12. Módulo: Atribución de Pauta

### ¿Qué es?

Mide el rendimiento real de los anuncios en Meta, Google y TikTok vs las ventas atribuidas.

### KPIs

- **Inversión en pauta:** Total gastado en anuncios (14 días)
- **CPA:** Costo por adquisición
- **ROAS:** Return on Ad Spend
- **Conversión reportada:** Conversiones que las plataformas reportan

### Tabla de anuncios

Cada anuncio muestra:

| Columna | Descripción |
|---------|-------------|
| Anuncio (ID plataforma) | Nombre + ID + campaña |
| Plataforma | Meta, Google, TikTok |
| Inversión | Gasto en la plataforma |
| CTR/CPC | Click-through rate + costo por click |
| Conv. rep. | Conversiones reportadas por la plataforma |
| Ventas reales | Ventas atribuidas realmente |
| Ingresos | Revenue generado |
| CPA | Costo por adquisición real |
| ROAS | Return on Ad Spend real |
| Veredicto | Optimizar, Pausar, Escalar, Vigilar, Apagar |

### Funciones

- **Kill switch:** Botón para pausar anuncios canibalizadores
- **Detectar canibalización:** Indicador violeta cuando un anuncio atribuye ventas que no le corresponden
- **Importar gastos:** Importa datos de gasto desde las plataformas
- **Tooltips:** Información detallada al pasar el mouse

---

## 13. Módulo: Monetización

### ¿Qué es?

Gestión de comisiones sobre GMV (Gross Merchandise Value) con tramos escalonados.

### Tramos de comisión

| Tramo | GMV mensual | Comisión |
|-------|-------------|----------|
| Inicial | $0 — $10M COP | 4.5% |
| Medio | $10M — $40M COP | 3.0% |
| Premium | > $40M COP | 1.75% |

### Funciones

- **GMV actual:** Total de ventas del mes
- **Comisión reconocida:** Monto de comisión acumulado
- **Total estimado:** Fee base + comisión
- **Embudo de pedidos:** Visualización del embudo (datos completados → despachado → entregado)
- **Entradas de comisión:** Lista de comisiones por pedido con estado (pendiente, reconocida, pagada)
- **Generar factura:** Crea una factura con CUFE DIAN (Ley 1230/2020, Decreto 745/2014)

### Reconocimiento en 2 momentos

1. **50% en "Datos completados"** — El cliente completó sus datos
2. **100% en "Despachado"** — El pedido fue enviado

---

## 14. Módulo: Wallet

### ¿Qué es?

Billetera digital para traffickers con balance, retiros y autenticación de dos factores (2FA).

### Panel de balance

- **Balance disponible:** Monto disponible para retiro
- **Comisiones pendientes:** Comisiones no reconocidas todavía
- **Retiros pendientes:** Retiros en procesamiento
- **Total retirado:** Histórico de retiros

### Acciones rápidas

- **Solicitar retiro:** Abre dialog con monto + cuenta + código 2FA
- **Registrar cuenta:** Banco, tipo, número, titular
- **Activar 2FA:** Escanea código QR con app autenticadora (Google Authenticator, Authy)
- **Ver transacciones:** Lista de todas las transacciones

### Seguridad 2FA

- **TOTP (RFC 6238):** Código de 6 dígitos que cambia cada 30 segundos
- **Códigos de respaldo:** 10 códigos de un solo uso para emergencias
- **AES-256-GCM:** Secretos 2FA encriptados en base de datos
- **Verificación obligatoria:** Retiros requieren código TOTP válido

### Proceso de retiro

1. El trafficker solicita retiro con código 2FA
2. El sistema crea una solicitud con estado `pending_2fa`
3. El admin/finance aprueba el retiro → estado `processed`
4. El balance se descuenta atómicamente ($transaction)

---

## 15. Módulo: Inteligencia Logística

### ¿Qué es?

Scores de transportadoras y clientes, guías estancadas, y alertas de comportamiento.

### Tabs

#### Tab 1: Scores de Clientes

- Tabla con score por cliente (0-100)
- Nivel: VIP, Regular, En riesgo, Nuevo
- Filtros por nivel y búsqueda

#### Tab 2: Scores de Transportadoras

- Gráfico de barras con on-time rate por transportadora
- Tabla de detalle con issues por transportadora
- Servientrega, Coordinadora, 99envios, Aveonline, Dropi

#### Tab 3: Guías Estancadas

- Lista de guías sin actualización >3 días
- Botón "Crear novedad" para cada guía estancada
- Filtros por transportadora

#### Tab 4: Alertas de Comportamiento

- Alertas automáticas de clientes con comportamiento anormal
- Severidad: Alta, Media, Baja
- Ejemplo: "Cliente con 3 devoluciones en 30 días"

---

## 16. Módulo: Marketplace

### ¿Qué es?

Marketplace cross-brand para compartir leads y listings entre las 4 marcas.

### Tabs

#### Tab 1: Catálogo Cross-brand

- Productos de todas las marcas en una sola vista
- Botón "Referir" para enviar un lead a otra marca
- Filtros por marca, categoría, precio

#### Tab 2: Mis Listings

- Tus productos publicados en el marketplace
- Toggle activar/desactivar
- Editar descripción y precio

#### Tab 3: Referencias

- Leads enviados y recibidos
- Estado: Pendiente, Aceptado, Rechazado, Comisionado
- Comisión por lead referido

### Configuración

- Compartir leads: Activar/desactivar
- Porcentaje de comisión por lead
- Marcas destino permitidas

---

## 17. Módulo: Novedades

### ¿Qué es?

Sistema de gestión de incidencias post-venta (devoluciones, reclamos, cambios).

### Tabs

#### Tab 1: Casos

- Lista de casos con número (NV-YYYY-XXXXX)
- Filtros por tipo, estado, transportadora, búsqueda
- Click en caso → panel de detalle

#### Tab 2: Reintentos de Entrega

- Solicitudes de reenvío
- Estado: Pendiente, Programado, Completado, Cancelado
- Crear nueva solicitud de reintento

#### Tab 3: Historial

- Casos cerrados/resueltos
- Búsqueda histórica

### Detalle del caso

- **Mensajes:** Historial de comunicación con el cliente
- **Evidencia:** Imágenes subidas (fotos del producto, guía, etc.)
- **Intentos de reintento:** Historial de reintentos de entrega
- **Acciones:** Cambiar estado, añadir mensaje, crear reintento

---

## 18. Módulo: Gobernanza

### ¿Qué es?

Panel de gobernanza para mandatos AP2, escalaciones humanas y trazabilidad de decisiones de IA.

### Tab 1: Escalaciones Pendientes

- Sesiones de checkout UCP en estado `requires_escalation`
- Razón: Orden >$5M COP, primera compra, cambio de método de pago
- Acciones: **Aprobar** o **Rechazar** (admin/finance/support)
- Cada escalación muestra: sesión, mandato, carrito, motivo

### Tab 2: Decisiones Recientes

- Log de decisiones de agentes de IA
- Muestra: agente, confidence, input, output, modelo, tokens, costo, latencia
- Estado de revisión humana: Pendiente, Aprobado, Rechazado, Modificado
- Acciones: Revisar (admin/finance/support)

### Reglas de escalamiento automático

| Regla | Umbral | Acción |
|-------|--------|--------|
| Orden de alto valor | > $5M COP | Escalar a humano |
| Primera compra | Cliente nuevo | Escalar a humano |
| Cambio de método de pago | Cualquier cambio | Escalar a humano |
| Pagos fallidos | ≥3 intentos | Bloquear |

### Determinación de responsabilidad

| Escenario | Responsable |
|-----------|-------------|
| Dentro de límites del mandato | Comercio (merchant) |
| Excede límites del mandato | Proveedor del agente |
| Sin mandato | Proveedor del agente (total) |
| Mandato revocado antes del carrito | Proveedor del agente (total) |

---

## 19. Módulo: Catálogo e Integraciones

### ¿Qué es?

Gestión de integraciones con plataformas de e-commerce, logística, pagos, pauta y IA.

### Cotizador de Flete

- Ingresa ciudad destino, país, unidades
- Cotiza con Dropi, 99envios, Aveonline
- Compara precios y tiempos

### Identificador de Productos (VLM)

- Pega URL de imagen
- La IA (glm-4.6v) identifica el producto
- Devuelve: SKU, categoría, confianza, pregunta de confirmación

### Catálogo de Productos

- Grid de productos sincronizados
- Botón "Recargar" para re-sincronizar
- Filtro por plataforma (WooCommerce, Shopify, Supabase, WhatsApp Catalog)

### Integraciones por categoría

#### E-commerce (4)
- WooCommerce — REST API
- Shopify — REST/GraphQL Admin API
- Supabase — Cliente SQL
- Oracle — Legacy read-only

#### Logística (3)
- Dropi — Multitransportadora CO
- 99envios — Tarifa negociada CO
- Aveonline — Multitransportadora CO + internacional

#### Pagos (4)
- MercadoPago — LATAM
- Wompi — Colombia (Bancolombia)
- Stripe — Internacional
- PayU — LATAM

#### Pauta (2)
- Google Ads — GAQL v17
- TikTok Ads — Marketing API v1.3

#### Canales (3)
- WhatsApp — Cloud API
- Messenger — Page Messaging
- Instagram — DM API

#### IA (3)
- ZAI (glm-4.6) — Default
- OpenAI — Alternativo
- xAI (Grok) — Alternativo
- Ollama — Local

### Gestión de Credenciales

- Cada integración tiene un panel expandible
- Los campos de credenciales se enmascaran (****)
- Las credenciales se guardan encriptadas (AES-256-GCM)
- Botón "Eliminar credenciales" para limpiar

---

## 20. Módulo: Configuración

### ¿Qué es?

Configuración del tenant: estrategia de pago, canales, umbrales del trafficker, e integraciones.

### Estrategia de pago por canal

Para cada canal (WhatsApp, Messenger, Instagram):

| Campo | Descripción |
|-------|-------------|
| Estrategia | Anticipado, Contra entrega, Híbrido |
| Mínimo para prepago | Monto mínimo para requerir prepago (COP) |
| % descuento prepago | Descuento por pago anticipado |
| Recargo envío COD | Recargo por contra entrega |

### Umbrales del Trafficker

- Comisión porcentaje
- ROAS mínimo para escalar anuncios
- CPA máximo permitido

### Canales de Mensajería

- Lista de canales activos
- Editar credenciales (token, phone number ID, etc.)
- Verificar conexión

### Integraciones (estado real)

- Lista de todas las integraciones
- Estado: Configurado, Pendiente, Error
- Botón de test por integración

### Webhooks & Endpoints

- URLs de webhook para cada pasarela de pago
- URLs de verificación para Meta/WhatsApp
- Copy-paste para configurar en las plataformas

---

## 21. Páginas Públicas

### Páginas disponibles sin login

| Página | URL | Descripción |
|--------|-----|-------------|
| **Login** | `/login` | Inicio de sesión |
| **Directorio** | `/directorio` | Lista de marcas/tiendas |
| **Estado del sistema** | `/status` | Status page con uptime + incidentes |
| **Política de Privacidad** | `/privacy` | Compliance Ley 1581 |
| **Términos de Servicio** | `/terms` | Términos legales |
| **Legal** | `/legal` | Hub legal |
| **Consentimiento parental** | `/compliance/parental-consent` | Ley 1098 (menores) |
| **Vendedor** | `/vendedor` | Portal del vendedor |
| **Documentación API** | `/docs` | ReDoc OpenAPI |
| **Storefront** | `/t/[slug]` | Tienda pública por marca |
| **Producto** | `/t/[slug]/p/[sku]` | Página de producto individual |

### Status Page (`/status`)

- Estado general del sistema (Operacional, Degradado, Caído)
- Checks individuales (Base de datos, Servicio de mensajería)
- Barra de uptime 90 días (cuadritos verdes/amarillos/rojos)
- Incidentes recientes con severidad y timeline
- Latencia de cada check

### Admin de Incidentes (`/admin/incidents`)

- Solo admin
- Crear incidente (título, descripción, severidad)
- Actualizar estado (Investigando → Identificado → Monitoreando → Resuelto)
- Timeline de actualizaciones por incidente

---

## 22. Compliance Regulatorio

### Ley 2573 de 2026 (Suplantación de Identidad)

- **KYC Gate:** Verificación de identidad requerida para:
  - Compras a crédito o cuotas
  - Órdenes > $2M COP
- **Evidence hash:** Se guarda hash criptográfico de la evidencia
- **Vigencia:** 90 días desde la verificación

### Ley 1581 de 2012 (Protección de Datos)

- **Consent records:** Registro de consentimiento por propósito (marketing, analytics, IA)
- **DSR (Data Subject Request):** Endpoints para acceso, borrado y portabilidad
- **Retención automática:** Limpieza diaria de datos según política:
  - Clientes inactivos: 5 años → anonimización
  - Conversaciones: 2 años → eliminación
  - Audit logs: 7 años → eliminación
  - Consent revocado: 5 años → eliminación

### Ley 1480 de 2011 (Estatuto del Consumidor)

- **Derecho al retracto:** 5 días para cancelar compra online
- **Reembolso automático:** Procesado vía pasarela de pago al ejercer retracto
- **Plazo legal:** 30 días máximo para reembolso

### Ley 1098 de 2006 (Infancia y Adolescencia)

- **Age gate:** Verificación de edad para menores de 18
- **Consentimiento parental:** Requerido para compras de menores
- **Bloqueo automático:** Menores sin consentimiento no pueden completar checkout

### Decreto 745/2014 (Facturación Electrónica DIAN)

- **CUFE:** Código Único de Factura Electrónica (SHA-384)
- **Alegra:** Integración con proveedor DIAN autorizado
- **Envío automático:** Factura enviada a DIAN + email al cliente
- **PDF:** Representación gráfica de la factura

---

## 23. Protocolos Agénticos

ZIAY implementa 5 protocolos para interoperabilidad con agentes de IA externos:

### AP2 (Agent Payments Protocol)

- **Mandatos:** Intent → Cart → Payment (firmados con ed25519)
- **W3C Verifiable Credentials:** Formato estándar de la industria
- **Revocable:** Los mandatos pueden revocarse en cualquier momento
- **Gobernanza:** FIDO Alliance (donado por Google, abril 2026)

### UCP (Universal Commerce Protocol)

- **Manifest:** `/.well-known/ucp` — descubre las capacidades del comercio
- **4 capacidades:** Checkout, Identity Linking, Order, Payment Token Exchange
- **State machine:** incomplete → requires_escalation → ready_for_complete → completed
- **Multi-transporte:** REST, MCP, A2A, embebido

### ACP (Agentic Commerce Protocol)

- **Manifest:** `/.well-known/acp` — para ChatGPT/Copilot
- **Bearer auth:** Mandato AP2 firmado como token
- **Endpoints:** checkout, orders, refunds

### MCP (Model Context Protocol)

- **Endpoint:** `/api/mcp` — JSON-RPC 2.0
- **4 tools:** ziay_search_catalog, ziay_create_checkout, ziay_get_order_status, ziay_list_payment_methods
- **Para:** Claude, ChatGPT, y cualquier cliente MCP

### A2A (Agent-to-Agent)

- **Agent card:** `/.well-known/agent-card` — discovery
- **Capacidades:** catalog, checkout, payment, order
- **Protocolos soportados:** ucp, ap2, acp, mcp, a2a

---

## 24. Atajos de Teclado

| Atajo | Acción | Contexto |
|-------|--------|----------|
| `⌘K` / `Ctrl+K` | Abrir paleta de comandos | Global |
| `?` | Abrir paleta de comandos | Global (no en inputs) |
| `1` - `9` | Saltar a vista N | Global (no en inputs) |
| `Enter` | Enviar mensaje | Mensajería |
| `⇧+Enter` | Salto de línea | Mensajería |
| `Tab` | Navegar entre elementos | Global |
| `Escape` | Cerrar dialog/paleta | Global |

### Paleta de Comandos (⌘K)

- Busca por nombre de vista
- Muestra atajos numéricos (1-9)
- Navegación con flechas + Enter
- Cierra con Escape

---

## 25. PWA — App Instalable

### Instalación en Móvil

#### Android (Chrome)
1. Abre ZIAY en Chrome
2. Menú ⋮ → **Agregar a pantalla de inicio**
3. Confirma

#### iOS (Safari)
1. Abre ZIAY en Safari
2. Botón Compartir → **Agregar a inicio**
3. Confirma

### Instalación en Desktop

1. Abre ZIAY en Chrome/Edge
2. Icono de instalación en la barra de direcciones
3. Click → **Instalar**

### Funciones Offline

- **Service worker:** Cachea el shell de la aplicación
- **Navegación offline:** Muestra la última versión cacheada
- **Sync automático:** Sincroniza cuando vuelve la conexión

---

## 26. Solución de Problemas

### No puedo iniciar sesión

| Problema | Solución |
|----------|----------|
| Correo/contraseña incorrectos | Verifica credenciales. Usa botones de demo para probar |
| Página en blanco | Limpia cache del navegador (Ctrl+Shift+R) |
| "Error crítico del sistema" | Contacta a soporte@ziay.co |
| Redirect loop | Borra cookies del sitio y reintenta |

### No veo datos en el dashboard

| Problema | Solución |
|----------|----------|
| Todo en cero | Verifica que el tenant seleccionado tenga datos |
| Skeleton infinito | Click en "Refrescar" o recarga la página |
| Error "Failed to load" | Click en "Reintentar" en la alerta |
| Datos antiguos | Click en "Refrescar" para forzar actualización |

### La IA no responde

| Problema | Solución |
|----------|----------|
| Sin respuesta | Verifica que el orquestador no esté en pausa |
| Respuesta tardía | La IA tiene timeout de 15s; si tarda más, usa fallback |
| Respuesta incorrecta | La IA tiene confidence < 0.6 → escala a humano |
| "Presupuesto excedido" | El admin debe aumentar el presupuesto en Costos de IA |

### WhatsApp no recibe mensajes

| Problema | Solución |
|----------|----------|
| No llegan mensajes | Verifica webhook en Meta Business → configúralo en Integraciones |
| Mensajes duplicados | El sistema tiene 3 capas de deduplicación; verifica en logs |
| No se pueden enviar | Verifica token de WhatsApp Cloud API en Configuración |

### No puedo retirar de Wallet

| Problema | Solución |
|----------|----------|
| "Código 2FA requerido" | Ingresa tu código TOTP de Google Authenticator |
| "Código 2FA inválido" | Verifica que el código sea actual (cambia cada 30s) |
| 2FA no configurado | Activa 2FA en Wallet → "Activar 2FA" |
| "Pending processing" | Espera aprobación del admin/finance |

### Pago no procesa

| Problema | Solución |
|----------|----------|
| Error en checkout | Verifica credenciales de la pasarela en Integraciones |
| Webhook no llega | Verifica URL del webhook en la plataforma de pago |
| Pago duplicado | El sistema es idempotente; verifica en Pedidos |
| PSE/PIX no disponible | Verifica credenciales del método local en .env |

---

## 27. Glosario

| Término | Definición |
|---------|------------|
| **AP2** | Agent Payments Protocol — protocolo de pagos para agentes de IA |
| **AOV** | Average Order Value — valor promedio por pedido |
| **CAPI** | Conversions API — API server-side de Meta para atribución |
| **CPA** | Cost Per Acquisition — costo por adquisición |
| **CTWA** | Click-to-WhatsApp Ads — anuncios que abren chat de WhatsApp |
| **CUFE** | Código Único de Factura Electrónica — hash SHA-384 DIAN |
| **GMV** | Gross Merchandise Value — valor total de mercancía vendida |
| **KYC** | Know Your Customer — verificación de identidad |
| **LCP** | Largest Contentful Paint — métrica de Core Web Vitals |
| **LLM** | Large Language Model — modelo de lenguaje (ej: glm-4.6, GPT-4) |
| **MCP** | Model Context Protocol — protocolo para que LLMs llamen herramientas |
| **PWA** | Progressive Web App — app web instalable con offline |
| **ROAS** | Return on Ad Spend — retorno sobre inversión en pauta |
| **TOTP** | Time-based One-Time Password — código 2FA de 6 dígitos |
| **TTR** | Time To Respond — tiempo de primera respuesta |
| **UCP** | Universal Commerce Protocol — protocolo de catálogo + checkout |
| **VLM** | Vision Language Model — modelo de lenguaje con visión (ej: glm-4.6v) |
| **W3C VC** | W3C Verifiable Credential — estándar de credenciales verificables |

---

## Resultados de QA

La plataforma ZIAY v0.4.0 fue sometida a una ronda completa de pruebas QA (Quality Assurance) y un ciclo de 3 iteraciones de audit fintech antes de su liberación. El scorecard final es **9.9/10** — el único punto deducido corresponde a `health = warning` en dev (el chat-service no corre en el sandbox de desarrollo, pero sí en el stack de producción, donde se resuelve a `ok`). El audit fintech independiente alcanzó **8.8/10** tras 3 iteraciones (V1 5.5 → V2 7.7 → V3 8.8).

### Resumen del build

| Verificación | Resultado |
|--------------|-----------|
| ESLint (`bun run lint`) | ✅ 0 errores · 38 warnings (legacy, pre-existentes en scripts/tests) |
| TypeScript (`tsc --noEmit`) | ✅ **0 errores** (fue 58 antes de la remediación v0.4.0; `next.config.ts ignoreBuildErrors: false`) |
| Next.js Build | ✅ Compilado exitosamente en 32.4s |
| Vitest (`bun run test`) | ✅ **986/986 pruebas pasan** (51 archivos, fue 964 antes del audit cycle) |
| Playwright E2E (`bun run test:e2e`) | ✅ **52/52 pruebas pasan** (7 spec files) |
| CI Pipeline | ✅ 6/6 jobs green (lint, typecheck, unit-tests, openapi-spec, build, e2e) |
| Redocly (OpenAPI 3.1) | ✅ 0 errores, 0 warnings |
| Prisma schema | ✅ Válido |
| Workflows n8n | ✅ 28/28 JSON válidos |

### Cobertura de pruebas (986 unit tests en 51 archivos + 52 E2E en 7 spec files)

| Categoría | Pruebas | Archivos | Detalle |
|-----------|---------|----------|---------|
| Service tests | 289/289 ✅ | 14 | Todos los 14 servicios probados |
| Webhook tests | 175/175 ✅ | 10 | 8 webhooks + edge cases + rotación de firma |
| AI agent tests | 167/167 ✅ | 6 | schemas, route, budget, TTL, VLM, golden cases |
| Compliance tests | 101/101 ✅ | 5 | age-gate, retention, compliance-edge, AP2 mandates, UCP checkout |
| Payment/TOTP/format tests | 93/93 ✅ | 7 | Incluye 2FA + formateo de moneda |
| Security middleware tests | 85/85 ✅ | 7 | CORS, CSRF, ETag, cache-headers, sanitize, HMAC, rate-limit |
| Integration tests | 72/72 ✅ | 4 | AP2 chain, UCP checkout, CAPI autofire, WhatsApp inbound |
| E2E Playwright specs | 7 archivos | 7 | auth, api, dashboard, governance, llm-costs, ssr-pages, status-page |

### Endpoints probados

| Tipo | Resultado |
|------|-----------|
| Endpoints públicos | 15/15 = 200 ✅ (`/login`, `/.well-known/{ucp,acp,agent-card}`, `/status`, `/directorio`, `/privacy`, `/terms`, `/legal`, `/api/health{,/live,/ready}`, `/api/metrics`, `/api/public/tenants`, `/docs`) |
| Endpoints protegidos (sin auth) | 3/3 correctos ✅ (`/api/overview` = 401, `/api/orders` = 401, `/admin/incidents` = 307) |
| APIs autenticadas | 20 probadas ✅ (16 = 200, 4 = 400 esperados para POST sin body) |
| Storefront SSR | `/t/saramantha` = 200 ✅ |
| Protocolos agénticos | UCP (4 capabilities), ACP (3), A2A (5 protocols), MCP (4 tools) — todos 200 ✅ |

### Headers de seguridad (6/6 presentes ✅)

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Robots-Tag: noindex, follow`

### Operación

| Métrica | Estado |
|---------|--------|
| Prometheus metrics | DB connected = 1, tenants = 5 ✅ |
| Health check | status = warning (chat-service no corre en dev — `ok` en producción) ✅ |
| PWA | manifest + service worker + icon + OG + RegisterSW — todos presentes ✅ |

### Accesibilidad (WCAG 2.1 AA)

skip-link ✅ · h1 sr-only ✅ · `role=alert` en 12 vistas ✅ · `prefers-reduced-motion` ✅ · 93 atributos `aria-label` ✅

### Modo oscuro

179 clases `dark:` de Tailwind · `enableSystem = true` ✅

### Auditoría de calidad de código

- Tipos `any`: 3 (solo en comentarios — ninguno en código en runtime) ✅
- `@ts-ignore`: 0 ✅
- `.env` en git: 0 (no rastreado) ✅
- Usos de `requireTenantAccess`: 155 (defensa cross-tenant) ✅
- Schemas Zod: 91 (validación de input/output) ✅

### Scorecard QA Final

| Dimensión | Score | Estado |
|-----------|-------|--------|
| Build | 10/10 | ✅ Compilado en 32.4s |
| Tests | 10/10 | ✅ 986/986 unit + 52/52 E2E pasan |
| Endpoints públicos | 10/10 | ✅ 15/15 = 200 |
| Endpoints protegidos | 10/10 | ✅ 401/307 correctos |
| Endpoints autenticados | 10/10 | ✅ 16/16 = 200 (+ 4 esperados 400) |
| Storefront SSR | 10/10 | ✅ 200 |
| Protocolos | 10/10 | ✅ 4/4 activos (UCP, ACP, A2A, MCP) |
| Security headers | 10/10 | ✅ 6/6 presentes |
| Health | 9/10 | ✅ (chat-service en dev — `ok` en prod) |
| Metrics | 10/10 | ✅ Formato Prometheus |
| Documentación | 10/10 | ✅ 7 docs + 22 ADRs + 28 n8n workflows |
| **OVERALL** | **9.9/10** | ✅ |

> El detalle completo del reporte de QA está en `worklog.md` (sección "QA REPORT — ZIAY v0.4.0"), `RELEASE-NOTES.md` (sección "QA Testing"), `docs/FINAL-REPORT.md` (sección "QA Results"), y los reports de audit fintech V3 en `public/presentaciones/AUDITORIA-FINTECH-V3-FINAL.md`.

---

## Contacto

| Equipo | Contacto |
|--------|----------|
| **Soporte general** | soporte@ziay.co |
| **Datos personales** | datos@ziay.co |
| **Operaciones** | ops@ziay.co |
| **Finanzas** | finanzas@ziay.co |
| **Onboarding** | onboarding@ziay.co |

---

*ZIAY v0.4.0 "Comercio Agéntico" · ZIAY SAS © 2026 · Bogotá, Colombia*
