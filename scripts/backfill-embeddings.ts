// Backfill embeddings for existing messages that have no embedding yet.
// Run: bun run scripts/backfill-embeddings.ts
import { db } from '../src/lib/db'
import { embedText, embedToBytes } from '../src/lib/embeddings/service'

async function main() {
  const messages = await db.message.findMany({ where: { embedding: null }, take: 500 })
  console.log(`Backfilling embeddings for ${messages.length} messages...`)
  let count = 0
  for (const m of messages) {
    const vec = await embedText(m.body)
    if (vec) {
      await db.message.update({ where: { id: m.id }, data: { embedding: embedToBytes(vec) } })
      count++
    }
  }
  console.log(`Done: backfilled ${count}/${messages.length} messages with embeddings.`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(async () => { await db.$disconnect() })
