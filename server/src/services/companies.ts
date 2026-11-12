// Stub file for upstream features not in Ciutatis
// Companies service

import type { Db } from "@paperclipai/db";

export function companyService(_db: Db) {
  return {
    // Stub - company operations handled by institutionService in Ciutatis
    async getById(_id: string): Promise<{ id: string; name: string } | null> {
      return null;
    },
    async update(
      _id: string,
      _data: { budgetMonthlyCents?: number },
    ): Promise<{ id: string } | null> {
      // Return a mock company object to satisfy upstream code that checks truthiness
      return { id: _id };
    },
  };
}
