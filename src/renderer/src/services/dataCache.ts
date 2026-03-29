interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

class DataCache {
  private projects: CacheEntry<Project[]> | null = null
  private unitsByProject = new Map<number, CacheEntry<Unit[]>>()
  private letters: CacheEntry<MaintenanceLetter[]> | null = null
  private payments: CacheEntry<Payment[]> | null = null

  private readonly DEFAULT_TTL = 60000 // 1 minute
  private readonly MAX_UNITS_CACHE_SIZE = 50

  private isExpired(entry: CacheEntry<unknown>): boolean {
    return Date.now() - entry.timestamp > entry.ttl
  }

  private evictOldestUnitEntry(): void {
    if (this.unitsByProject.size === 0) return
    let oldestKey: number | undefined
    let oldestTime = Infinity
    for (const [key, entry] of this.unitsByProject) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }
    if (oldestKey !== undefined) {
      this.unitsByProject.delete(oldestKey)
    }
  }

  private setUnitsEntry(projectId: number, entry: CacheEntry<Unit[]>): void {
    if (this.unitsByProject.size >= this.MAX_UNITS_CACHE_SIZE && !this.unitsByProject.has(projectId)) {
      this.evictOldestUnitEntry()
    }
    this.unitsByProject.set(projectId, entry)
  }

  async getProjects(fetchFn: () => Promise<Project[]>): Promise<{ data: Project[]; fromCache: boolean; stale: boolean }> {
    if (this.projects && !this.isExpired(this.projects)) {
      return { data: this.projects.data, fromCache: true, stale: false }
    }

    try {
      const data = await fetchFn()
      this.projects = { data, timestamp: Date.now(), ttl: this.DEFAULT_TTL }
      return { data, fromCache: false, stale: false }
    } catch (error) {
      if (this.projects) {
        console.warn('[DataCache] Returning stale projects data due to fetch error')
        return { data: this.projects.data, fromCache: true, stale: true }
      }
      throw error
    }
  }

  async getUnitsByProject(
    projectId: number,
    fetchFn: (id: number) => Promise<Unit[]>
  ): Promise<{ data: Unit[]; fromCache: boolean; stale: boolean }> {
    const entry = this.unitsByProject.get(projectId)
    if (entry && !this.isExpired(entry)) {
      return { data: entry.data, fromCache: true, stale: false }
    }

    try {
      const data = await fetchFn(projectId)
      this.setUnitsEntry(projectId, { data, timestamp: Date.now(), ttl: this.DEFAULT_TTL })
      return { data, fromCache: false, stale: false }
    } catch (error) {
      if (entry) {
        console.warn(`[DataCache] Returning stale units data for project ${projectId} due to fetch error`)
        return { data: entry.data, fromCache: true, stale: true }
      }
      throw error
    }
  }

  async getLetters(fetchFn: () => Promise<MaintenanceLetter[]>): Promise<{ data: MaintenanceLetter[]; fromCache: boolean; stale: boolean }> {
    if (this.letters && !this.isExpired(this.letters)) {
      return { data: this.letters.data, fromCache: true, stale: false }
    }

    try {
      const data = await fetchFn()
      this.letters = { data, timestamp: Date.now(), ttl: this.DEFAULT_TTL }
      return { data, fromCache: false, stale: false }
    } catch (error) {
      if (this.letters) {
        console.warn('[DataCache] Returning stale letters data due to fetch error')
        return { data: this.letters.data, fromCache: true, stale: true }
      }
      throw error
    }
  }

  async getPayments(fetchFn: () => Promise<Payment[]>): Promise<{ data: Payment[]; fromCache: boolean; stale: boolean }> {
    if (this.payments && !this.isExpired(this.payments)) {
      return { data: this.payments.data, fromCache: true, stale: false }
    }

    try {
      const data = await fetchFn()
      this.payments = { data, timestamp: Date.now(), ttl: this.DEFAULT_TTL }
      return { data, fromCache: false, stale: false }
    } catch (error) {
      if (this.payments) {
        console.warn('[DataCache] Returning stale payments data due to fetch error')
        return { data: this.payments.data, fromCache: true, stale: true }
      }
      throw error
    }
  }

  invalidateProjects(): void {
    this.projects = null
  }

  invalidateUnits(projectId?: number): void {
    if (projectId !== undefined) {
      this.unitsByProject.delete(projectId)
    } else {
      this.unitsByProject.clear()
    }
  }

  invalidateLetters(): void {
    this.letters = null
  }

  invalidatePayments(): void {
    this.payments = null
  }

  invalidateAll(): void {
    this.projects = null
    this.unitsByProject.clear()
    this.letters = null
    this.payments = null
  }

  clear(): void {
    this.invalidateAll()
  }
}

export const dataCache = new DataCache()

// Types for cache
interface Project {
  id: number
  name: string
  project_code?: string
  status?: string
}

interface Unit {
  id: number
  project_id: number
  unit_number: string
  owner_name: string
  project_name?: string
  [key: string]: unknown
}

interface MaintenanceLetter {
  id: number
  project_id: number
  unit_id: number
  financial_year: string
  [key: string]: unknown
}

interface Payment {
  id: number
  project_id: number
  unit_id: number
  [key: string]: unknown
}
