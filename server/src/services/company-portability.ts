// Stub - company-portability feature intentionally removed from Ciutatis
// This file exists only to satisfy upstream imports

import type { Db } from "@paperclipai/db";

export interface CompanyPortabilityService {
  exportCompany(): Promise<unknown>;
  importCompany(): Promise<unknown>;
  previewImport(_body?: unknown): Promise<unknown>;
  exportBundle(_companyId: string, _body?: unknown): Promise<unknown>;
  importBundle(_body: unknown, _userId?: string | null): Promise<unknown>;
}

export function companyPortabilityService(_db: Db): CompanyPortabilityService {
  return {
    async exportCompany() {
      throw new Error("Company portability not available in Ciutatis");
    },
    async importCompany() {
      throw new Error("Company portability not available in Ciutatis");
    },
    async previewImport() {
      throw new Error("Company portability not available in Ciutatis");
    },
    async exportBundle() {
      throw new Error("Company portability not available in Ciutatis");
    },
    async importBundle() {
      throw new Error("Company portability not available in Ciutatis");
    },
  };
}
