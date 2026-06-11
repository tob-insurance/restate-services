import type { CustomerId } from "./branded.js";

export interface Account {
  actingCode: string;
  code: CustomerId;
  email?: string;
  fullName: string;
  name?: string;
  virtualAccount?: string;
}
