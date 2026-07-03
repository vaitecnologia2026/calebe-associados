export class ApiError extends Error {
  status?: number;
  data?: unknown;

  constructor(message: string, status?: number, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor?: string | null;
  take?: number;
  _cacheHit?: boolean;
  _cacheAgeMs?: number;
}

export interface ConversationsListResponse {
  data: import("./conversation").Conversation[];
  nextCursor?: string | null;
  take?: number;
  _cacheHit?: boolean;
  _cacheAgeMs?: number;
}
