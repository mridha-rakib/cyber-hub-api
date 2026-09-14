export interface ApiResponse<TData = unknown, TMeta = unknown> {
  success: true;
  message: string;
  data: TData;
  meta?: TMeta;
  requestId: string;
}

export interface ApiErrorResponse<TDetails = unknown> {
  error: {
    code: string;
    message: string;
    details?: TDetails;
  };
  requestId: string;
}
