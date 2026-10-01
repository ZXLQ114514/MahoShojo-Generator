import {
  consumeRegistrationCode as consume,
  finalizeRegistrationCodeClaim as finalize,
  releaseRegistrationCodeClaim as release,
  startRegistrationCodeDispatch as startDispatch,
} from '@mahoshojo/hosted-runtime/registration-codes';
import { getRuntimeD1ClientWithoutHttpFallback } from '@/lib/db/drizzle';

export type RegistrationCodeClaim = { claimId: string; codeId: string };

export async function consumeRegistrationCode(code: string): Promise<RegistrationCodeClaim | null> {
  const client = getRuntimeD1ClientWithoutHttpFallback();
  if (!client) return null;
  return consume(client, code);
}

export async function finalizeRegistrationCodeClaim(claimId: string): Promise<boolean> {
  const client = getRuntimeD1ClientWithoutHttpFallback();
  return client ? finalize(client, claimId) : false;
}


export async function releaseRegistrationCodeClaim(claimId: string): Promise<boolean> {
  const client = getRuntimeD1ClientWithoutHttpFallback();
  return client ? release(client, claimId) : false;
}

export async function startRegistrationCodeDispatch(claimId: string): Promise<boolean> {
  const client = getRuntimeD1ClientWithoutHttpFallback();
  return client ? startDispatch(client, claimId) : false;
}
