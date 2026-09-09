export interface ApiResponse<TData = unknown, TMeta = unknown> {
  success: true;
  message: string;
  data: TData;
  meta?: TMeta;
}

export interface ApiErrorResponse<TMetadata = unknown> {
  success: false;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path?: string;
  metadata?: TMetadata;
}
