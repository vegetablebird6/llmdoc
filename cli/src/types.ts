export interface PaginationResult<T> {
  items: T[];
  totalItems: number;
  returnedItems: number;
  totalEstimatedTokens: number;
  returnedEstimatedTokens: number;
  nextCursor: string | null;
}

export interface OutputOptions {
  json?: boolean;
  cursor?: string;
  budget?: number;
  limit?: number;
}
