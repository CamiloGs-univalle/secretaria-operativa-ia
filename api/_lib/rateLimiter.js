// Rate Limiter mejorado — sliding window con limpieza automática
// En producción usar Upstash Redis (ver comentario abajo)
// npm install @upstash/ratelimit @upstash/redis

class RateLimiter {
  constructor(options = {}) {
    this.max = options.max || 10
    this.windowMs = options.windowMs || 10 * 60 * 1000 // 10 min
    this.cleanupInterval = options.cleanupInterval || 5 * 60 * 1000 // 5 min
    this.store = new Map()
    this.cleanupTimer = null
    this.startCleanup()
  }

  startCleanup() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupInterval)
    this.cleanupTimer.unref?.()
  }

  cleanup() {
    const now = Date.now()
    for (const [key, timestamps] of this.store.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs)
      if (valid.length === 0) {
        this.store.delete(key)
      } else {
        this.store.set(key, valid)
      }
    }
  }

  isLimited(key) {
    const now = Date.now()
    const windowStart = now - this.windowMs
    
    let timestamps = this.store.get(key) || []
    // Filtrar timestamps fuera de la ventana
    timestamps = timestamps.filter(t => t > now - this.windowMs)
    
    if (timestamps.length >= this.max) {
      return true
    }
    
    timestamps.push(now)
    this.store.set(key, timestamps)
    return false
  }

  reset(key) {
    this.store.delete(key)
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}

// Instancia global por defecto
export const defaultRateLimiter = new RateLimiter({
  max: 10,
  windowMs: 10 * 60 * 1000
})

// Para uso con Upstash Redis en producción (comentado - requiere npm install @upstash/ratelimit @upstash/redis y UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN en env)
/*
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

export const upstashRateLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 m'),
  analytics: true,
})
*/

export { RateLimiter }