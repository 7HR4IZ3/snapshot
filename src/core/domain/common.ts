export interface JsonError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface JsonResponse {
  ok: boolean;
  command: string;
  timestamp: string;
  data: unknown;
  errors: JsonError[];
}
