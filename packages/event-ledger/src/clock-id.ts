export interface Clock {
  now(): string;
}

export interface IdGen {
  next(prefix: string): string;
}
