// Cross-platform post-build step (Task ID: E2E-RATELIMIT-FIX-001)
// Replaces the Unix-only `cp -r` commands in the build script so the
// project builds on Windows as well as Linux/macOS.
import fs from 'fs'
import path from 'path'

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[post-build] Source not found: ${src} (skipping)`)
    return
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true })
  }
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

console.warn('[post-build] Copying .next/static -> .next/standalone/.next/static')
copyRecursive('.next/static', '.next/standalone/.next/static')

console.warn('[post-build] Copying public -> .next/standalone/public')
copyRecursive('public', '.next/standalone/public')

console.warn('[post-build] Done.')