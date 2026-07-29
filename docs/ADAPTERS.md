# Capa de Adaptadores — ZIAY

Documentación de la capa de adaptadores que desacopla los agentes conversacionales y el orquestador de las plataformas concretas de ecommerce, logística y LLM. Sigue el patrón **Registry** para resolver la implementación concreta en runtime según la configuración del tenant.

> 📖 Código fuente: [`../src/lib/adapters/`](../src/lib/adapters/) y [`../src/lib/llm/`](../src/lib/llm/)
> 📖 Documento Saramantha: §8 (adapters), §9 (webhooks), §16.8 (multi-IA)

---

## 📋 Tabla de contenidos

- [Patrón Registry](#patrón-registry)
- [EcommerceAdapter](#ecommerceadapter)
- [LogisticsAdapter](#logisticsadapter)
- [LLMAdapter](#llmadapter)
- [Carrier normalization](#carrier-normalization)
- [Cómo añadir un nuevo adaptador](#cómo-añadir-un-nuevo-adaptador)
- [Tabla resumen](#tabla-resumen)

---

## Patrón Registry

El núcleo del diseño es que **los agentes nunca saben con qué plataforma están hablando**. Todos llaman a la misma interfaz (`EcommerceAdapter`, `LogisticsAdapter`, `LLMAdapter`), y un **registry** resuelve la implementación concreta según la configuración del tenant.

### Flujo

```
Agente / API route
       │
       ▼
getEcommerceAdapter(tenantId)   ←── Registry
       │                            │
       │                            ├── Lee Tenant.plataformaCatalogo
       │                            ├── Lee Tenant.bdCatalogo
       │                            └── Lee variables de entorno
       │
       ▼
[EcommerceAdapter concreto]
       │
       ├── WhatsappCatalogAdapter  (si plataformaCatalogo='whatsapp_catalog')
       ├── WooCommerceAdapter      (si plataformaCatalogo='woocommerce')
       ├── ShopifyAdapter          (si plataformaCatalogo='shopify')
       ├── SupabaseCatalogAdapter  (si bdCatalogo='supabase_*' y plataformaCatalogo='catalogo_*')
       └── OracleCatalogAdapter    (si bdCatalogo='oracle_nuestro')
       │
       ▼
[HTTP real a la plataforma]  o  [stub con datos demo]
```

### Ventajas

1. **Aislamiento**: un agente no sabe si está hablando con WhatsApp Catalog, WooCommerce, Shopify, Supabase, o Oracle.
2. **Testabilidad**: cada adapter se puede testear en aislamiento.
3. **Extensibilidad**: añadir una nueva plataforma solo requiere implementar la interfaz + añadir un caso al registry.
4. **Multi-tenant**: cada tenant usa su adapter configurado, sin acoplamiento entre tenants.
5. **Fallback graceful**: si no hay credenciales reales configuradas, el adapter opera en modo stub con datos demo realistas.

---

## EcommerceAdapter

**Código**: [`../src/lib/adapters/ecommerce-adapter.ts`](../src/lib/adapters/ecommerce-adapter.ts)
**Saramantha**: §8.1–§8.5

### Interfaz

```typescript
export interface EcommerceAdapter {
  buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]>
  obtenerProducto(sku: string): Promise<ProductSearchResult | null>
  crearPedido(datos: CrearPedidoInput): Promise<CrearPedidoResult>
  actualizarInventario(sku: string, cantidad: number): Promise<ActualizarInventarioResult>
  obtenerEstadoPedido(order_id: string): Promise<EstadoPedidoResult>
}
```

### Tipos auxiliares

```typescript
interface ProductSearchResult {
  sku: string
  name: string
  precio: number
  imagen_url: string
  stock: number
  diseno?: string       // "Stitch", "Hello Kitty"
  categoria?: string    // "familia", "short", "pantalon", "batola"
}

interface CrearPedidoInput {
  contacto_id: string
  items: { sku: string; cantidad: number }[]
  valor: number
  direccion: Record<string, string>   // mapa libre (cada plataforma tiene su shape)
  imagen_referencia_url?: string      // §2: VLM-detected
}

interface CrearPedidoResult {
  order_id: string
  estado: string
  url_seguimiento?: string
}

interface ActualizarInventarioResult {
  ok: boolean
  stock_actual: number
}

interface EstadoPedidoResult {
  estado: string
  fecha_actualizacion: string
}
```

### 5 implementaciones

#### 1. `WhatsappCatalogAdapter`

**Código**: [`../src/lib/adapters/whatsapp-catalog.ts`](../src/lib/adapters/whatsapp-catalog.ts)
**Saramantha**: §8.1
**Configuración del tenant**: `plataformaCatalogo='whatsapp_catalog'`

**Comportamiento**:
- `buscarProductos` / `obtenerProducto`: lee `Product` con `fuenteSincronizacion='whatsapp_catalog'` filtrado por `tenantId`.
- `crearPedido`: **registra el pedido en el núcleo** (tabla `Order`) — Meta no expone API para crear pedidos en WhatsApp Catalog. El envío del `order_card` message se hace en una capa de mensajería separada.
- `actualizarInventario`: write-through a la tabla `Product.stock`.
- `obtenerEstadoPedido`: lee `Order.status` local.

**Cuándo se usa**: para los 4 tenants ZIAY (Saramantha, Majestic, Lovely, Reina) que gestionan su catálogo nativamente en WhatsApp Commerce Manager.

#### 2. `WooCommerceAdapter`

**Código**: [`../src/lib/adapters/woocommerce.ts`](../src/lib/adapters/woocommerce.ts)
**Saramantha**: §8.2
**Configuración del tenant**: `plataformaCatalogo='woocommerce'`
**Variables de entorno**: `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`, `WOOCOMMERCE_STORE_URL`

**Comportamiento**:
- **Con creds**: HTTP real a `{WOOCOMMERCE_STORE_URL}/wp-json/wc/v3/products` con Basic Auth (`consumer_key:consumer_secret`). Map de la respuesta WooCommerce a `ProductSearchResult`.
- **Sin creds**: lee `Product` con `fuenteSincronizacion='woocommerce'` ya existente en DB (modo stub).

**Endpoint real usado**: `GET /wp-json/wc/v3/products?search={query}&per_page=20`

#### 3. `ShopifyAdapter`

**Código**: [`../src/lib/adapters/shopify.ts`](../src/lib/adapters/shopify.ts)
**Saramantha**: §8.3
**Configuración del tenant**: `plataformaCatalogo='shopify'`
**Variables de entorno**: `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_SHOP`

**Comportamiento**:
- **Con creds**: POST real a `https://{SHOPIFY_SHOP}/admin/api/2024-01/graphql.json` con header `X-Shopify-Access-Token`. Usa GraphQL Admin API.
- **Sin creds**: modo stub.

**GraphQL query usada**:

```graphql
query SearchProducts($query: String!) {
  products(first: 20, query: $query) {
    edges {
      node {
        id
        title
        handle
        variants(first: 1) {
          edges {
            node {
              sku
              price
              inventoryQuantity
            }
          }
        }
        featuredImage { url }
      }
    }
  }
}
```

#### 4. `SupabaseCatalogAdapter`

**Código**: [`../src/lib/adapters/supabase-catalog.ts`](../src/lib/adapters/supabase-catalog.ts)
**Saramantha**: §8.4
**Configuración del tenant**: `bdCatalogo='supabase_cliente'` (read-only) o `bdCatalogo='supabase_nuestro'` (read-write)
**Variables de entorno**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**Comportamiento**:
- **Modo `cliente`** (read-only): usa `SUPABASE_ANON_KEY` con PostgREST. `actualizarInventario` retorna `ok: false` sin escribir (§8.4 — no podemos modificar el catálogo del cliente).
- **Modo `nuestro`** (read-write): usa `SUPABASE_SERVICE_ROLE_KEY` con bypassa RLS. `actualizarInventario` escribe realmente.

**Por qué importa el modo**: cuando provisionamos Supabase para un cliente que no tiene catálogo (escenario §12.4), usamos modo `nuestro` y el cliente puede gestionar su catálogo vía la UI de Supabase. Cuando un cliente ya tiene su Supabase, usamos modo `cliente` y respetamos su RLS.

#### 5. `OracleCatalogAdapter`

**Código**: [`../src/lib/adapters/oracle-catalog.ts`](../src/lib/adapters/oracle-catalog.ts)
**Saramantha**: §8.5 / §9.5
**Configuración del tenant**: `bdCatalogo='oracle_nuestro'`
**Variables de entorno**: `ORACLE_CONNECTION_STRING`, `ORACLE_USER`, `ORACLE_PASSWORD`

**Comportamiento**: actualmente es un **stub con TODO detallado** para integración real con `oracledb` + wallet mTLS + PL/SQL. No hace HTTP — falla con error explícito indicando que la integración real está pendiente.

**TODO de integración real** (en el código):

```typescript
// TODO: Para integración real:
// 1. Instalar `oracledb` (npm i oracledb)
// 2. Configurar Oracle Wallet mTLS en el contenedor (montar volumen)
// 3. Crear pool de conexiones en el constructor
// 4. Para buscarProductos: SELECT sku, nombre, precio, imagen_url, stock
//    FROM productos WHERE tenant_id = :tenantId AND LOWER(nombre) LIKE '%' || LOWER(:query) || '%'
// 5. Para crearPedido: invocar PL/SQL package commerceflow.pedidos_api.crear_pedido(...)
// 6. Para actualizarInventario: UPDATE productos SET stock = stock - :cantidad WHERE sku = :sku
// 7. Manejar errores Oracle específicos (ORA-XXXXX)
// 8. Configurar statement cache y connection pool sizing
```

**Cuándo se usa**: para tenants enterprise con Oracle on-premise (Saramantha §9.5 menciona bases Oracle nuestras para clientes enterprise).

---

## LogisticsAdapter

**Código**: [`../src/lib/adapters/logistics-adapter.ts`](../src/lib/adapters/logistics-adapter.ts)
**Saramantha**: §8.6

### Interfaz

```typescript
export interface LogisticsAdapter {
  cotizarFlete(ciudad: string, pais: string, cantidad_unidades: number): Promise<FreightQuote>
  generarGuia(datos_pedido: GenerarGuiaInput): Promise<ShipmentResult>
  consultarEstadoGuia(numero_guia: string): Promise<ShipmentStatus>
  reportarNovedad(numero_guia: string, tipo_novedad: string): Promise<{ ok: boolean; siguiente_accion: string }>
}
```

### Tipos auxiliares

```typescript
interface FreightQuote {
  tarifa: number              // COP si pais='CO', USD si internacional
  tiempo_estimado_dias: number
  transportadora: string      // "Coordinadora", "TCC", "Servientrega", "Envía", "Interrapidísimo"
}

interface ShipmentResult {
  numero_guia: string
  url_seguimiento: string
  transportadora: string
}

interface ShipmentStatus {
  estado: string
  ultima_actualizacion: string
  novedad?: string
}

interface GenerarGuiaInput {
  contacto_id: string
  direccion: Record<string, string>
  valor: number
  items_count: number
}
```

### Por qué una sola interfaz para 3 proveedores

Los 3 proveedores soportados (Dropi, 99envios, Aveonline) son plataformas colombianas **MULTITRANSPORTADORA** — cotizan y generan guía indistintamente con TCC, Coordinadora, Interrapidísimo, Servientrega y Envía desde un solo panel. Por eso la interfaz común es la misma sin importar cuál esté detrás.

### 3 implementaciones

#### 1. `DropiAdapter`

**Código**: [`../src/lib/adapters/dropi.ts`](../src/lib/adapters/dropi.ts)
**Saramantha**: §8.6
**Configuración del tenant**: `proveedorLogistico='dropi'`
**Variables de entorno**: `DROPI_API_KEY`

**Comportamiento**:
- **Con `DROPI_API_KEY`**: HTTP real a `https://api.dropi.co/api/v2/rates` con header `Authorization: Bearer {apiKey}`. Procesa la respuesta real.
- **Sin creds**: tabla hardcodeada de tarifas realistas calibradas al mercado dropshipping colombiano 2024-2025:

| Ciudad | Tarifa (COP) | Días | Transportadora |
|--------|--------------|------|----------------|
| Bogotá | $8,000 - $9,500 | 1 | Coordinadora |
| Medellín | $10,500 | 2 | TCC |
| Cali | $11,000 | 2 | Servientrega |
| Pasto | $14,000 - $15,500 | 4 | Envía |
| Cartagena | $13,000 | 3 | Envía |
| (Internacional) Madrid | $54 USD | 10 | DHL |

#### 2. `Envios99Adapter` (99envios)

**Código**: [`../src/lib/adapters/99envios.ts`](../src/lib/adapters/99envios.ts)
**Saramantha**: §8.6
**Configuración del tenant**: `proveedorLogistico='99envios'`
**Variables de entorno**: `ENVIOS99_API_KEY`

> 📝 El nombre de la clase es `Envios99Adapter` (no `99EnviosAdapter`) porque TypeScript no permite identificadores que empiecen con dígito.

**Comportamiento**:
- ~5% más barato que Dropi en ciudades principales (Bogotá, Medellín, Cali).
- Más caro en ciudades periféricas (Pasto, Leticia).

#### 3. `AveonlineAdapter`

**Código**: [`../src/lib/adapters/aveonline.ts`](../src/lib/adapters/aveonline.ts)
**Saramantha**: §8.6
**Configuración del tenant**: `proveedorLogistico='aveonline'`
**Variables de entorno**: `AVEONLINE_API_KEY`

**Comportamiento**:
- Más fuerte en Antioquia (Medellín, Bello, Itagüí, Envigado).
- Más caro en Caribe (Cartagena, Barranquilla, Santa Marta).

### Normalización de carriers

Los 3 adapters llaman a `normalizeCarrierName(tenantId, rawName)` antes de retornar la transportadora. Esto normaliza las **6 variantes de "Interrapidísimo"** (Saramantha §15.2) al nombre canónico definido en la tabla `Carrier`.

Ver [Carrier normalization](#carrier-normalization) más abajo.

---

## LLMAdapter

**Código**: [`../src/lib/llm/adapter.ts`](../src/lib/llm/adapter.ts)
**Saramantha**: §16.8

### Interfaz

```typescript
export interface LLMAdapter {
  name: string
  complete(messages: LLMMessage[]): Promise<string>
  completeVision(systemPrompt: string, userParts: LLMVisionPart[]): Promise<string>
  embed(text: string): Promise<number[] | null>
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMVisionPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}
```

### 4 implementaciones

#### 1. `ZaiAdapter` (default)

**Código**: `src/lib/llm/adapter.ts` (clase `ZaiAdapter`)
**Configuración del tenant**: `proveedorIa='zai'` (default)
**Variables de entorno**: ninguna — `z-ai-web-dev-sdk` no requiere creds.

**Modelos**:
- Texto: configuración default del SDK (`glm-4.6`).
- Vision: `glm-4.6v` (modelo multimodal del SDK).
- Embeddings: NO soportado (retorna `null` — el sistema cae a TF-hash in-memory).

**Cuándo se usa**: es el proveedor por defecto. Siempre disponible, sin configuración. Recomendado para tenants pequeños o para dev/staging.

#### 2. `OpenAIAdapter` (ChatGPT)

**Código**: `src/lib/llm/adapter.ts` (clase `OpenAIAdapter`)
**Configuración del tenant**: `proveedorIa='chatgpt'`
**Variables de entorno**: `OPENAI_API_KEY`

**Modelos**:
- Texto: `gpt-4o-mini` (default, configurable en el constructor).
- Vision: `gpt-4o`.
- Embeddings: `text-embedding-3-small` (1536 dims).

**Comportamiento**: HTTP real a `https://api.openai.com/v1/chat/completions` con `Authorization: Bearer {apiKey}`. Para vision, mismo endpoint con `image_url` content parts. Para embeddings, `https://api.openai.com/v1/embeddings`.

**Cuándo se usa**: tenant BYO (Bring Your Own) OpenAI key. Facturación directa a la cuenta OpenAI del tenant.

#### 3. `XaiAdapter` (Grok)

**Código**: `src/lib/llm/adapter.ts` (clase `XaiAdapter`)
**Configuración del tenant**: `proveedorIa='xai'`
**Variables de entorno**: `XAI_API_KEY`

**Modelos**:
- Texto: `grok-2-latest`.
- Vision: `grok-2-vision-latest`.
- Embeddings: NO soportado (xAI no expone endpoint público).

**Comportamiento**: HTTP real a `https://api.x.ai/v1/chat/completions` con `Authorization: Bearer {apiKey}`. Mismo formato que OpenAI.

#### 4. `OllamaAdapter` (self-hosted)

**Código**: `src/lib/llm/adapter.ts` (clase `OllamaAdapter`)
**Configuración del tenant**: `proveedorIa='ollama'`
**Variables de entorno**: `OLLAMA_BASE_URL` (default `http://localhost:11434`)

**Modelos**:
- Texto: `llama3.1` (configurable).
- Vision: `llama3.2-vision`.
- Embeddings: `nomic-embed-text` (768 dims).

**Comportamiento**: HTTP real a `{OLLAMA_BASE_URL}/api/chat` para chat y a `{OLLAMA_BASE_URL}/api/embeddings` para embeddings. Las imágenes se convierten a base64 antes de enviar (Ollama no soporta URLs).

**Cuándo se usa**: tenant con requisito explícito de no-cloud (datos sensibles on-premise). También útil para dev local con GPU.

### Registry LLM

```typescript
export async function getLLMAdapter(tenantId: string): Promise<LLMAdapter> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  switch (tenant.proveedorIa) {
    case 'chatgpt': return new OpenAIAdapter(process.env.OPENAI_API_KEY!)
    case 'xai':     return new XaiAdapter(process.env.XAI_API_KEY!)
    case 'ollama':  return new OllamaAdapter(process.env.OLLAMA_BASE_URL)
    case 'zai':
    default:        return new ZaiAdapter()
  }
}
```

> 📝 En producción, las API keys deben venir de un secrets manager keyed by `Tenant.credencialesIaRef`, no de `process.env` global. El código actual usa `process.env` como fallback para simplificar el demo.

---

## Carrier normalization

**Código**: [`../src/lib/carriers.ts`](../src/lib/carriers.ts)
**Saramantha**: §15.2

### Problema

Los proveedores logísticos devuelven nombres de transportadora con typos y variantes. El caso extremo documentado en Saramantha §15.2 es **Interrapidísimo**, que aparece en 6 variantes en los 239 pedidos reales del CRM:

```
Interrapidísimo
Interrapidisimo
interrapidisimo
Interrapidicimo
Interrapidísimmo
INTERRAPIDISIMO
```

Estos deben normalizarse todos a `Interrapidísimo` antes de persistirse en `Shipment.transportadoraCanonica`.

### Solución

`normalizeCarrierName(tenantId, rawName)` implementa triple estrategia:

1. **Match exacto** contra `Carrier.nombreCanonico` del tenant.
2. **Match por variantes** — busca `rawName` en `Carrier.variantes` (comma-separated).
3. **ASCII fold** — normaliza ambos strings (lowercase, sin acentos, sin espacios) y compara. Esto atrapa variantes no listadas explícitamente.

Si ninguna estrategia matchea, retorna el `rawName` tal cual con un TODO para revisar manualmente.

### Tabla `Carrier`

Cada tenant configura sus carriers canónicos en la tabla `Carrier`:

```typescript
model Carrier {
  id              String @id @default(cuid())
  tenantId        String
  nombreCanonico  String   // "Interrapidísimo"
  variantes       String   // "Interrapidisimo,interrapidisimo,Interrapidicimo,..."
  cobertura       String   // "nacional" | "internacional"

  @@unique([tenantId, nombreCanonico])
}
```

### Seed

El seed crea 5 carriers canónicos por tenant con sus variantes:

1. **Servientrega** — variantes: `servientrega, SERVIENTREGA, Servientrega SA`
2. **Interrapidísimo** — variantes: `Interrapidisimo, interrapidisimo, Interrapidicimo, Interrapidísimmo, INTERRAPIDISIMO`
3. **Coordinadora** — variantes: `coordinadora, Coordinadora Mercantil`
4. **Envía** — variantes: `envia, Envía, Envia SA`
5. **TCC** — variantes: `tcc, TCC SA, Transportes TCC`

---

## Cómo añadir un nuevo adaptador

### EcommerceAdapter

1. **Crea el archivo** `src/lib/adapters/mi-ecommerce.ts`:

```typescript
import { EcommerceAdapter, ProductSearchResult, CrearPedidoInput, CrearPedidoResult, ActualizarInventarioResult, EstadoPedidoResult } from './ecommerce-adapter'

export class MiEcommerceAdapter implements EcommerceAdapter {
  constructor(
    private tenantId: string,
    private apiKey?: string,
    private baseUrl?: string
  ) {}

  async buscarProductos(query: string, filtros?: Record<string, unknown>): Promise<ProductSearchResult[]> {
    if (this.apiKey && this.baseUrl) {
      // HTTP real
      const res = await fetch(`${this.baseUrl}/api/products?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      })
      const data = await res.json()
      return data.products.map((p: any) => ({
        sku: p.sku,
        name: p.name,
        precio: p.price,
        imagen_url: p.image,
        stock: p.stock,
        diseno: p.design,
        categoria: p.category
      }))
    }
    // Fallback a stub — lee de la DB local
    const products = await db.product.findMany({
      where: { tenantId: this.tenantId, fuenteSincronizacion: 'mi_ecommerce', OR: [{ name: { contains: query } }, { sku: { contains: query } }] },
      take: 20
    })
    return products.map(p => ({
      sku: p.sku, name: p.name, precio: p.price, imagen_url: p.imageUrl || '',
      stock: p.stock, diseno: p.diseno || undefined, categoria: p.categoria || undefined
    }))
  }

  // ... implementar los otros 4 métodos
}
```

2. **Añade al registry** en `src/lib/adapters/registry.ts`:

```typescript
export async function getEcommerceAdapter(tenantId: string): Promise<EcommerceAdapter> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  switch (tenant.plataformaCatalogo) {
    case 'mi_ecommerce':
      return new MiEcommerceAdapter(
        tenantId,
        process.env.MI_ECOMMERCE_API_KEY,
        process.env.MI_ECOMMERCE_BASE_URL
      )
    // ... casos existentes
  }
}
```

3. **Variables de entorno** — añade a `.env.example`:

```bash
# Mi Ecommerce — for tenants with plataformaCatalogo='mi_ecommerce'
MI_ECOMMERCE_API_KEY=
MI_ECOMMERCE_BASE_URL=
```

4. **Documenta** en `docs/ENVIRONMENT.md` y en este archivo.

5. **Test smoke**:

```bash
# Sin creds → debe caer a stub
curl -X POST http://localhost:3000/api/catalog/sync -d '{"tenantId":"ten-test"}'

# Con creds → debe hacer HTTP real
MI_ECOMMERCE_API_KEY=test MI_ECOMMERCE_BASE_URL=https://api.test.com
curl -X POST http://localhost:3000/api/catalog/sync -d '{"tenantId":"ten-test"}'
```

### LogisticsAdapter o LLMAdapter

Mismo patrón: implementa la interfaz, añade al registry, documenta las variables de entorno.

### Reglas de oro para adaptadores

1. **Todo método debe scopear por `tenantId`** — nunca filtrar por variables globales o default.
2. **Todo método debe tener fallback a stub** cuando no haya creds o cuando la API falle.
3. **Todo HTTP debe tener timeout** (recomendado: 10s para buscar, 30s para crear pedido).
4. **Todo error debe loguearse** con contexto (tenantId, endpoint, status code).
5. **Nunca exponer el adapter concreto al agente** — el agente solo conoce la interfaz.
6. **Las credenciales se leen del secrets manager en prod, no de `process.env` directamente** (el código actual usa `process.env` como fallback temporal).

---

## Tabla resumen

| Tipo | Implementación | Configuración tenant | Variables de entorno | Estado |
|------|----------------|---------------------|----------------------|--------|
| Ecommerce | `WhatsappCatalogAdapter` | `plataformaCatalogo='whatsapp_catalog'` | (ninguna) | ✅ Funcional |
| Ecommerce | `WooCommerceAdapter` | `plataformaCatalogo='woocommerce'` | `WOOCOMMERCE_CONSUMER_KEY`, `_SECRET`, `_STORE_URL` | ✅ HTTP real + stub fallback |
| Ecommerce | `ShopifyAdapter` | `plataformaCatalogo='shopify'` | `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_SHOP` | ✅ GraphQL real + stub fallback |
| Ecommerce | `SupabaseCatalogAdapter` | `bdCatalogo='supabase_cliente'` o `'supabase_nuestro'` | `SUPABASE_URL`, `_ANON_KEY`, `_SERVICE_ROLE_KEY` | ✅ Modo read-only y read-write |
| Ecommerce | `OracleCatalogAdapter` | `bdCatalogo='oracle_nuestro'` | `ORACLE_CONNECTION_STRING`, `_USER`, `_PASSWORD` | ⚠️ Stub con TODO detallado |
| Logistics | `DropiAdapter` | `proveedorLogistico='dropi'` | `DROPI_API_KEY` | ✅ HTTP real + stub fallback |
| Logistics | `Envios99Adapter` | `proveedorLogistico='99envios'` | `ENVIOS99_API_KEY` | ✅ Stub con datos realistas |
| Logistics | `AveonlineAdapter` | `proveedorLogistico='aveonline'` | `AVEONLINE_API_KEY` | ✅ Stub con datos realistas |
| LLM | `ZaiAdapter` (default) | `proveedorIa='zai'` | (ninguna) | ✅ Siempre disponible |
| LLM | `OpenAIAdapter` | `proveedorIa='chatgpt'` | `OPENAI_API_KEY` | ✅ HTTP real |
| LLM | `XaiAdapter` | `proveedorIa='xai'` | `XAI_API_KEY` | ✅ HTTP real |
| LLM | `OllamaAdapter` | `proveedorIa='ollama'` | `OLLAMA_BASE_URL` | ✅ HTTP real (self-hosted) |
| Carrier | `normalizeCarrierName(tenantId, rawName)` | tabla `Carrier` por tenant | (ninguna) | ✅ Triple estrategia |

---

## Roadmap de adaptadores

### Corto plazo (Q1 2026)

- **Oracle real**: implementar con `oracledb` + wallet mTLS + PL/SQL packages.
- **MercadoLibre adapter**: para tenants que venden en ML (común en LATAM).
- **Dropi HTTP real**: ya implementado pero falta probar con creds reales en staging.
- **99envios HTTP real**: aún en stub.
- **Aveonline HTTP real**: aún en stub.

### Medio plazo (Q2 2026)

- **Telegram adapter** (canal de mensajería adicional).
- **Voice adapter** (STT + TTS) — requiere integración con Whisper/TTS.
- **Wompi / MercadoPago / Stripe payment adapters** — para automatizar el checkout de pago anticipado.

### Largo plazo (Q3-Q4 2026)

- **Google Ads API** y **TikTok Ads API** adapters para atribución (actualmente solo Meta está wired end-to-end).
- **Rappi / PedidosYa adapter** para logística last-mile urbana.
- **Anthropic Claude adapter** como 5to LLM provider.
