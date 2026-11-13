import "server-only";
import { headers } from "next/headers";
import { clientAddressFrom } from "@/lib/domain/rate-limit";

/**
 * The calling client's address, read from the request the one way
 * (`clientAddressFrom`). Null when there is no request to read (a script, a test
 * that stands in for one): no address means no per-client limit, never a shared one.
 */
export async function clientAddress(): Promise<string | null> {
  try {
    const h = await headers();
    return clientAddressFrom((name) => h.get(name));
  } catch {
    return null;
  }
}
