export class AppError extends Error {
  aiCallId?: string;
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
