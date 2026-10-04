import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * Sin UPSTASH_* configurado, lib/kv.ts usa un archivo bajo `<cwd>/.data/`. Cada test corre con
 * su propio cwd temporal, así no toca los datos de desarrollo ni se pisan entre tests.
 */
export function useTempKv() {
  let dir: string;
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bodegueando-kv-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
