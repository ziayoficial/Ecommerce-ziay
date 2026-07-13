-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "nombreNegocio" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "plataformaCatalogo" TEXT NOT NULL DEFAULT 'whatsapp_catalog',
    "bdCatalogo" TEXT DEFAULT 'supabase_nuestro',
    "credencialesCatalogoRef" TEXT,
    "proveedorIa" TEXT NOT NULL DEFAULT 'zai',
    "credencialesIaRef" TEXT,
    "proveedorLogistico" TEXT NOT NULL DEFAULT 'dropi',
    "credencialesLogisticaRef" TEXT,
    "wabaId" TEXT,
    "wabaTokenRef" TEXT,
    "tonoMarca" TEXT,
    "nombreAsesora" TEXT,
    "politicaPago" TEXT,
    "preguntaPerfil" TEXT,
    "planMonetizacion" TEXT NOT NULL DEFAULT 'conecta',
    "feeBaseMensual" REAL NOT NULL DEFAULT 0,
    "comisionPctInicial" REAL NOT NULL DEFAULT 4.5,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'agent',
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "country" TEXT,
    "paymentStrategy" TEXT NOT NULL DEFAULT 'hybrid',
    "requirePrepayMin" REAL,
    "prepayDiscountPct" REAL DEFAULT 0,
    "codFee" REAL DEFAULT 0,
    "wabaId" TEXT,
    "phoneNumberId" TEXT,
    "whatsappToken" TEXT,
    "pageId" TEXT,
    "pageAccessToken" TEXT,
    "igAccountId" TEXT,
    "verifyToken" TEXT,
    "appSecret" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Channel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "psid" TEXT,
    "igId" TEXT,
    "email" TEXT,
    "country" TEXT,
    "city" TEXT,
    "address" TEXT,
    "perfilDetectado" TEXT,
    "notes" TEXT,
    "tags" TEXT,
    "lifetimeValue" REAL NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assigneeId" TEXT,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "sourceAdId" TEXT,
    "sourceCampaign" TEXT,
    "utm" TEXT,
    "perfilConversacion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "mediaUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "aiSuggested" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" REAL,
    "embedding" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" REAL NOT NULL,
    "cost" REAL NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "diseno" TEXT,
    "categoria" TEXT,
    "imagenMetadataVisible" BOOLEAN NOT NULL DEFAULT true,
    "fuenteSincronizacion" TEXT,
    "embeddingTexto" BLOB,
    "embeddingVisual" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "channelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "paymentMode" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "subtotal" REAL NOT NULL,
    "discount" REAL NOT NULL DEFAULT 0,
    "shipping" REAL NOT NULL DEFAULT 0,
    "codFee" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "country" TEXT,
    "city" TEXT,
    "address" TEXT,
    "imagenReferenciaUrl" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'agente_whatsapp',
    "sourceAdId" TEXT,
    "sourceCampaign" TEXT,
    "sourcePlatform" TEXT,
    "clickId" TEXT,
    "attributedAt" DATETIME,
    "paymentGateway" TEXT,
    "paymentRef" TEXT,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_sourceAdId_fkey" FOREIGN KEY ("sourceAdId") REFERENCES "Ad" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitPrice" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "diseno" TEXT,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VolumePrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "tipoCliente" TEXT NOT NULL,
    "cantidadMinima" INTEGER NOT NULL,
    "cantidadMaxima" INTEGER NOT NULL,
    "precioUnitario" REAL NOT NULL,
    CONSTRAINT "VolumePrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VolumePrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesSpeech" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "perfil" TEXT NOT NULL,
    "aperturaTexto" TEXT NOT NULL,
    "pruebaSocial" TEXT,
    CONSTRAINT "SalesSpeech_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Objection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "tipoObjecion" TEXT NOT NULL,
    "respuestaBase" TEXT NOT NULL,
    "gatilloMentalAsociado" TEXT,
    CONSTRAINT "Objection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ThemeDesign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "tema" TEXT NOT NULL,
    "nombreDiseno" TEXT,
    "skusAsociados" TEXT NOT NULL,
    CONSTRAINT "ThemeDesign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CategoryCombo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "skusRecomendados" TEXT NOT NULL,
    CONSTRAINT "CategoryCombo_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "contactoId" TEXT,
    "direccionNormalizada" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "departamento" TEXT,
    "resultadoEntregaAnterior" TEXT,
    CONSTRAINT "DeliveryHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImageIdentification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "contactoId" TEXT,
    "imagenUrl" TEXT NOT NULL,
    "skuDetectado" TEXT,
    "metodo" TEXT NOT NULL,
    "confianza" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AdPlatform" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountId" TEXT,
    "accessToken" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "budgetDaily" REAL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "status" TEXT NOT NULL DEFAULT 'active',
    "country" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Campaign_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "AdPlatform" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creative" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "autoKill" BOOLEAN NOT NULL DEFAULT false,
    "killReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ad_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdSpend" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "spend" REAL NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "convReported" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdSpend_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "model" TEXT NOT NULL DEFAULT 'last_click',
    "touch" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attribution_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Carrier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "nombreCanonico" TEXT NOT NULL,
    "variantes" TEXT NOT NULL,
    "cobertura" TEXT NOT NULL DEFAULT 'nacional',
    CONSTRAINT "Carrier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "proveedor" TEXT NOT NULL,
    "numeroGuia" TEXT,
    "urlSeguimiento" TEXT,
    "transportadora" TEXT,
    "transportadoraCanonica" TEXT,
    "tarifa" REAL NOT NULL DEFAULT 0,
    "tiempoEstimadoDias" INTEGER,
    "estado" TEXT NOT NULL DEFAULT 'generada',
    "novedad" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shipment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gmv" REAL NOT NULL,
    "comisionPct" REAL NOT NULL,
    "comisionTotal" REAL NOT NULL,
    "reconocidaPct" REAL NOT NULL DEFAULT 50,
    "reconocidaMonto" REAL NOT NULL,
    "etapaReconocimiento" TEXT,
    "reconocidaAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CommissionEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "gmvTotal" REAL NOT NULL,
    "feeBase" REAL NOT NULL,
    "comisionTotal" REAL NOT NULL,
    "tramoAplicado" TEXT NOT NULL,
    "total" REAL NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'borrador',
    "emitidaAt" DATETIME,
    "pagadaAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "condition" TEXT,
    "action" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "category" TEXT NOT NULL,
    "totalPedidos" INTEGER NOT NULL DEFAULT 0,
    "pedidosEntregados" INTEGER NOT NULL DEFAULT 0,
    "pedidosDevueltos" INTEGER NOT NULL DEFAULT 0,
    "lastOrderAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CarrierScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "totalGuias" INTEGER NOT NULL DEFAULT 0,
    "entregadas" INTEGER NOT NULL DEFAULT 0,
    "devueltas" INTEGER NOT NULL DEFAULT 0,
    "avgDeliveryDays" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GuideTracking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "carrierName" TEXT,
    "status" TEXT NOT NULL,
    "lastEventAt" DATETIME,
    "daysStuck" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GuideMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "carrierName" TEXT,
    "rawData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BuyerBehavior" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "patternDetails" TEXT,
    "totalReturns" INTEGER NOT NULL DEFAULT 0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BehaviorAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "buyerBehaviorId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConversationalCart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "total" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cartId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "total" REAL NOT NULL,
    CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "ConversationalCart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NovedadCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "phone" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "guideNumber" TEXT,
    "carrierName" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "assignedTo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME
);

-- CreateTable
CREATE TABLE "NovedadEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NovedadEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "NovedadCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NovedadMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NovedadMessage_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "NovedadCase" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RedeliveryRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "originalAddress" TEXT NOT NULL,
    "newAddress" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "scheduledAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RedeliveryAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "redeliveryId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "carrierResponse" TEXT,
    "agentNote" TEXT,
    "attemptedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RedeliveryAttempt_redeliveryId_fkey" FOREIGN KEY ("redeliveryId") REFERENCES "RedeliveryRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductEnrichment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "materials" TEXT,
    "colors" TEXT,
    "measurements" TEXT,
    "description" TEXT,
    "enrichmentScore" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Trafficker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "walletBalance" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TraffickerCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "budget" REAL NOT NULL,
    "spend" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TraffickerCampaign_traffickerId_fkey" FOREIGN KEY ("traffickerId") REFERENCES "Trafficker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TraffickerSale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" REAL NOT NULL,
    "commission" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TraffickerSale_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "TraffickerCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TraffickerTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "balanceBefore" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "description" TEXT,
    "reference" TEXT,
    "referenceType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TraffickerTransaction_traffickerId_fkey" FOREIGN KEY ("traffickerId") REFERENCES "Trafficker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TraffickerCompensation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "saleId" TEXT,
    "reason" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TraffickerCompensation_traffickerId_fkey" FOREIGN KEY ("traffickerId") REFERENCES "Trafficker" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT,
    "tenantId" TEXT,
    "userId" TEXT,
    "accountType" TEXT NOT NULL,
    "accountHolder" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "bankName" TEXT,
    "documentType" TEXT,
    "documentNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT,
    "tenantId" TEXT,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "balanceBefore" REAL NOT NULL DEFAULT 0,
    "balanceAfter" REAL NOT NULL DEFAULT 0,
    "description" TEXT,
    "reference" TEXT,
    "referenceType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT,
    "tenantId" TEXT,
    "walletAccountId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "fee" REAL NOT NULL DEFAULT 0,
    "netAmount" REAL NOT NULL DEFAULT 0,
    "totpRequired" BOOLEAN NOT NULL DEFAULT true,
    "totpVerified" BOOLEAN NOT NULL DEFAULT false,
    "totpVerifiedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending_2fa',
    "rejectionReason" TEXT,
    "externalReference" TEXT,
    "processedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WithdrawalRequest_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "WalletAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TwoFactorConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traffickerId" TEXT,
    "tenantId" TEXT,
    "userId" TEXT,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LeadShareConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "shareLeads" BOOLEAN NOT NULL DEFAULT false,
    "commissionPct" REAL NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LeadReferral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromTenantId" TEXT NOT NULL,
    "toTenantId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "reason" TEXT NOT NULL,
    "commission" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PixelConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "pixelId" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConversionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "pixelConfigId" TEXT,
    "eventType" TEXT NOT NULL,
    "value" REAL,
    "currency" TEXT NOT NULL DEFAULT 'COP',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "response" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SEOConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "keywords" TEXT,
    "ogImage" TEXT,
    "jsonLd" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GeoTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'CO',
    "region" TEXT,
    "city" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "RemarketingCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RemarketingMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RemarketingMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "RemarketingCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "customerName" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" DATETIME,
    "sentAt" DATETIME,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "VolumePrice_tenantId_productId_tipoCliente_cantidadMinima_key" ON "VolumePrice"("tenantId", "productId", "tipoCliente", "cantidadMinima");

-- CreateIndex
CREATE UNIQUE INDEX "SalesSpeech_tenantId_perfil_key" ON "SalesSpeech"("tenantId", "perfil");

-- CreateIndex
CREATE UNIQUE INDEX "Objection_tenantId_tipoObjecion_key" ON "Objection"("tenantId", "tipoObjecion");

-- CreateIndex
CREATE UNIQUE INDEX "ThemeDesign_tenantId_tema_key" ON "ThemeDesign"("tenantId", "tema");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryCombo_tenantId_categoria_key" ON "CategoryCombo"("tenantId", "categoria");

-- CreateIndex
CREATE UNIQUE INDEX "AdPlatform_name_key" ON "AdPlatform"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_externalId_key" ON "Ad"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpend_adId_date_key" ON "AdSpend"("adId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_tenantId_nombreCanonico_key" ON "Carrier"("tenantId", "nombreCanonico");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE INDEX "CustomerScore_tenantId_idx" ON "CustomerScore"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerScore_tenantId_phone_key" ON "CustomerScore"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "CarrierScore_tenantId_idx" ON "CarrierScore"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CarrierScore_tenantId_carrierName_key" ON "CarrierScore"("tenantId", "carrierName");

-- CreateIndex
CREATE INDEX "GuideTracking_tenantId_idx" ON "GuideTracking"("tenantId");

-- CreateIndex
CREATE INDEX "GuideTracking_tenantId_guideNumber_idx" ON "GuideTracking"("tenantId", "guideNumber");

-- CreateIndex
CREATE INDEX "GuideMovement_tenantId_guideNumber_idx" ON "GuideMovement"("tenantId", "guideNumber");

-- CreateIndex
CREATE INDEX "GuideMovement_tenantId_idx" ON "GuideMovement"("tenantId");

-- CreateIndex
CREATE INDEX "BuyerBehavior_tenantId_idx" ON "BuyerBehavior"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerBehavior_tenantId_phone_key" ON "BuyerBehavior"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "BehaviorAlert_tenantId_idx" ON "BehaviorAlert"("tenantId");

-- CreateIndex
CREATE INDEX "ConversationalCart_tenantId_idx" ON "ConversationalCart"("tenantId");

-- CreateIndex
CREATE INDEX "ConversationalCart_conversationId_idx" ON "ConversationalCart"("conversationId");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
CREATE UNIQUE INDEX "NovedadCase_caseNumber_key" ON "NovedadCase"("caseNumber");

-- CreateIndex
CREATE INDEX "NovedadCase_tenantId_idx" ON "NovedadCase"("tenantId");

-- CreateIndex
CREATE INDEX "NovedadCase_tenantId_status_idx" ON "NovedadCase"("tenantId", "status");

-- CreateIndex
CREATE INDEX "NovedadEvidence_caseId_idx" ON "NovedadEvidence"("caseId");

-- CreateIndex
CREATE INDEX "NovedadMessage_caseId_idx" ON "NovedadMessage"("caseId");

-- CreateIndex
CREATE INDEX "RedeliveryRequest_tenantId_idx" ON "RedeliveryRequest"("tenantId");

-- CreateIndex
CREATE INDEX "RedeliveryRequest_tenantId_status_idx" ON "RedeliveryRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RedeliveryAttempt_redeliveryId_idx" ON "RedeliveryAttempt"("redeliveryId");

-- CreateIndex
CREATE INDEX "ProductEnrichment_tenantId_idx" ON "ProductEnrichment"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEnrichment_tenantId_sku_key" ON "ProductEnrichment"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Trafficker_email_key" ON "Trafficker"("email");

-- CreateIndex
CREATE INDEX "Trafficker_email_idx" ON "Trafficker"("email");

-- CreateIndex
CREATE INDEX "TraffickerCampaign_traffickerId_idx" ON "TraffickerCampaign"("traffickerId");

-- CreateIndex
CREATE INDEX "TraffickerCampaign_tenantId_idx" ON "TraffickerCampaign"("tenantId");

-- CreateIndex
CREATE INDEX "TraffickerSale_traffickerId_idx" ON "TraffickerSale"("traffickerId");

-- CreateIndex
CREATE INDEX "TraffickerSale_tenantId_idx" ON "TraffickerSale"("tenantId");

-- CreateIndex
CREATE INDEX "TraffickerTransaction_traffickerId_createdAt_idx" ON "TraffickerTransaction"("traffickerId", "createdAt");

-- CreateIndex
CREATE INDEX "TraffickerCompensation_tenantId_idx" ON "TraffickerCompensation"("tenantId");

-- CreateIndex
CREATE INDEX "WalletTransaction_traffickerId_createdAt_idx" ON "WalletTransaction"("traffickerId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_tenantId_createdAt_idx" ON "WalletTransaction"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_traffickerId_idx" ON "WithdrawalRequest"("traffickerId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_tenantId_idx" ON "WithdrawalRequest"("tenantId");

-- CreateIndex
CREATE INDEX "WithdrawalRequest_status_idx" ON "WithdrawalRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactorConfig_traffickerId_key" ON "TwoFactorConfig"("traffickerId");

-- CreateIndex
CREATE UNIQUE INDEX "TwoFactorConfig_tenantId_key" ON "TwoFactorConfig"("tenantId");

-- CreateIndex
CREATE INDEX "MarketplaceListing_tenantId_idx" ON "MarketplaceListing"("tenantId");

-- CreateIndex
CREATE INDEX "MarketplaceListing_active_idx" ON "MarketplaceListing"("active");

-- CreateIndex
CREATE UNIQUE INDEX "LeadShareConfig_tenantId_key" ON "LeadShareConfig"("tenantId");

-- CreateIndex
CREATE INDEX "LeadReferral_fromTenantId_idx" ON "LeadReferral"("fromTenantId");

-- CreateIndex
CREATE INDEX "LeadReferral_toTenantId_idx" ON "LeadReferral"("toTenantId");

-- CreateIndex
CREATE INDEX "PixelConfig_tenantId_idx" ON "PixelConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PixelConfig_tenantId_platform_key" ON "PixelConfig"("tenantId", "platform");

-- CreateIndex
CREATE INDEX "ConversionEvent_tenantId_eventType_createdAt_idx" ON "ConversionEvent"("tenantId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "ConversionEvent_pixelConfigId_idx" ON "ConversionEvent"("pixelConfigId");

-- CreateIndex
CREATE INDEX "SEOConfig_tenantId_idx" ON "SEOConfig"("tenantId");

-- CreateIndex
CREATE INDEX "GeoTarget_tenantId_idx" ON "GeoTarget"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoTarget_tenantId_country_region_city_key" ON "GeoTarget"("tenantId", "country", "region", "city");

-- CreateIndex
CREATE INDEX "RemarketingCampaign_tenantId_idx" ON "RemarketingCampaign"("tenantId");

-- CreateIndex
CREATE INDEX "RemarketingMessage_tenantId_status_scheduledAt_idx" ON "RemarketingMessage"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CustomerNotification_tenantId_status_idx" ON "CustomerNotification"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CustomerNotification_tenantId_scheduledAt_idx" ON "CustomerNotification"("tenantId", "scheduledAt");

