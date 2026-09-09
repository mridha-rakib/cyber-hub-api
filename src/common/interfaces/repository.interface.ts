export interface FindManyOptions {
  limit?: number;
  offset?: number;
}

export interface IRepository<
  TEntity,
  TId = string,
  TCreate = Partial<TEntity>,
  TUpdate = Partial<TEntity>,
> {
  findById(id: TId): Promise<TEntity | null>;
  findMany(options?: FindManyOptions): Promise<TEntity[]>;
  create(payload: TCreate): Promise<TEntity>;
  update(id: TId, payload: TUpdate): Promise<TEntity>;
  softDelete(id: TId): Promise<void>;
}
