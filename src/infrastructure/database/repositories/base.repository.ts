import type { FindManyOptions, IRepository } from "../../../common/interfaces/repository.interface";
import { TransactionManager } from "../../../core/database/transaction.manager";

export abstract class BaseRepository<
  TEntity,
  TId = string,
  TCreate = Partial<TEntity>,
  TUpdate = Partial<TEntity>,
> implements IRepository<TEntity, TId, TCreate, TUpdate>
{
  protected constructor(protected readonly transactionManager: TransactionManager) {}

  protected get db() {
    return this.transactionManager.getExecutor();
  }

  abstract findById(id: TId): Promise<TEntity | null>;

  abstract findMany(options?: FindManyOptions): Promise<TEntity[]>;

  abstract create(payload: TCreate): Promise<TEntity>;

  abstract update(id: TId, payload: TUpdate): Promise<TEntity>;

  abstract softDelete(id: TId): Promise<void>;
}
