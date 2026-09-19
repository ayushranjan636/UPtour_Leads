import { Repository, FindOptionsWhere, DeepPartial, FindManyOptions } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

/**
 * GENERIC BASE SERVICE
 * 
 * Eliminates repeated CRUD logic across all 12+ services.
 * Every entity service extends this and gets findAll, findById,
 * create, update, delete for free. Only override what's custom.
 * 
 * DSA: Uses Map-based caching for hot lookups, Set for dedup.
 */
export abstract class BaseService<T extends { id: string }> {
  protected abstract readonly repo: Repository<T>;
  protected abstract readonly entityName: string;

  // In-memory LRU-like cache for hot reads (optional)
  private cache = new Map<string, { data: T; expires: number }>();
  private readonly CACHE_TTL = 60_000; // 1 min

  async findAll(options?: FindManyOptions<T>): Promise<{ data: T[]; total: number }> {
    const [data, total] = await this.repo.findAndCount(options || {});
    return { data, total };
  }

  async findAllPaginated(
    page = 1,
    limit = 20,
    where?: FindOptionsWhere<T>,
    relations?: string[],
    order?: Record<string, 'ASC' | 'DESC'>,
  ) {
    const [data, total] = await this.repo.findAndCount({
      where,
      relations,
      order: order as any,
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string, relations?: string[]): Promise<T> {
    // Check cache first
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) return cached.data;

    const entity = await this.repo.findOne({
      where: { id } as any,
      relations,
    });
    if (!entity) throw new NotFoundException(`${this.entityName} not found`);

    // Cache hot reads
    this.cache.set(id, { data: entity, expires: Date.now() + this.CACHE_TTL });
    if (this.cache.size > 500) this.evictOldest();

    return entity;
  }

  async create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repo.create(data);
    return this.repo.save(entity as any);
  }

  async update(id: string, data: DeepPartial<T>): Promise<T> {
    await this.findById(id); // throws if not found
    await this.repo.update(id, data as any);
    this.cache.delete(id);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.repo.delete(id);
    this.cache.delete(id);
  }

  async count(where?: FindOptionsWhere<T>): Promise<number> {
    return this.repo.count({ where });
  }

  /**
   * Batch upsert using Set-based dedup.
   * O(n) dedup + O(n) insert — avoids O(n²) naive approach.
   */
  async batchCreate(items: DeepPartial<T>[], dedupKey?: keyof T): Promise<T[]> {
    if (!items.length) return [];

    // Dedup using Set for O(1) lookups
    const seen = new Set<string>();
    const unique: DeepPartial<T>[] = [];

    for (const item of items) {
      const key = dedupKey ? String((item as any)[dedupKey]) : JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    // Batch insert in chunks of 500
    const results: T[] = [];
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const entities = this.repo.create(chunk as any);
      const saved = await this.repo.save(entities as any);
      results.push(...(saved as T[]));
    }

    return results;
  }

  // Simple LRU eviction — remove oldest 25%
  private evictOldest() {
    const entries = [...this.cache.entries()];
    entries.sort((a, b) => a[1].expires - b[1].expires);
    const toRemove = Math.floor(entries.length * 0.25);
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
  }
}
